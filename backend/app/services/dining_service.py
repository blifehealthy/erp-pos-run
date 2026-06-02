from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pos import CashierShift
from app.models.product import Product, Category
from app.models.restaurant import (
    DiningOrder, DiningOrderItem, DiningSession, DiningTable, KitchenTicket,
)
from app.models.settings import BranchSettings
from app.models.branch import Branch
from app.models.stock import StockLocation
from app.services.notification_service import NotificationService
from app.schemas.pos import CartItem, CreateSaleRequest, PaymentCreateRequest
from app.schemas.restaurant import (
    DiningOrderItemRead, DiningOrderRead, KitchenTicketRead,
    PlaceOrderRequest, PublicMenuProduct, PublicMenuResponse,
    PublicOrderStatus, SessionCheckoutRequest, SessionCheckoutResult,
    SessionOpen, SessionRead, TableRead,
)


class DiningService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _validate_ticket_transition(self, current_status: str, new_status: str) -> None:
        allowed: dict[str, set[str]] = {
            "pending": {"cooking", "cancelled"},
            "cooking": {"done", "cancelled"},
            "done": {"served"},
            "served": set(),
            "cancelled": set(),
        }
        if new_status == current_status:
            return
        if new_status not in allowed.get(current_status, set()):
            raise ValueError(f"ไม่สามารถเปลี่ยนสถานะจาก {current_status} เป็น {new_status} ได้")

    # ── Tables ────────────────────────────────────────────────────────────────

    async def list_tables(self, company_id: uuid.UUID, branch_id: uuid.UUID) -> list[TableRead]:
        rows = (await self.db.scalars(
            select(DiningTable)
            .where(DiningTable.company_id == company_id, DiningTable.branch_id == branch_id, DiningTable.is_active.is_(True))
            .order_by(DiningTable.sort_order, DiningTable.name)
        )).all()

        result: list[TableRead] = []
        for t in rows:
            active_session = await self.db.scalar(
                select(DiningSession)
                .options(selectinload(DiningSession.orders).selectinload(DiningOrder.items))
                .where(DiningSession.table_id == t.id, DiningSession.status.in_(["open", "bill_requested"]))
                .limit(1)
            )
            active_items: list[DiningOrderItem] = []
            qr_pending_count = 0
            if active_session:
                for order in active_session.orders:
                    if order.status == "cancelled":
                        continue
                    for item in order.items:
                        if item.status == "cancelled":
                            continue
                        active_items.append(item)
                        if order.source == "qr_self" and item.status == "pending":
                            qr_pending_count += item.qty
            result.append(TableRead(
                id=t.id, branch_id=t.branch_id, name=t.name, capacity=t.capacity,
                qr_token=t.qr_token, table_type=t.table_type, status=t.status,
                sort_order=t.sort_order, is_active=t.is_active,
                active_session_id=active_session.id if active_session else None,
                queue_number=active_session.queue_number if active_session else None,
                pending_count=sum(item.qty for item in active_items if item.status == "pending"),
                cooking_count=sum(item.qty for item in active_items if item.status == "cooking"),
                ready_count=sum(item.qty for item in active_items if item.status == "done"),
                served_count=sum(item.qty for item in active_items if item.status == "served"),
                qr_pending_count=qr_pending_count,
            ))
        return result

    async def get_table_by_token(self, qr_token: uuid.UUID) -> DiningTable | None:
        return await self.db.scalar(
            select(DiningTable).where(DiningTable.qr_token == qr_token, DiningTable.is_active.is_(True))
        )

    async def create_table(self, company_id: uuid.UUID, branch_id: uuid.UUID, name: str, capacity: int = 4, table_type: str = "dine_in", sort_order: int = 0) -> DiningTable:
        table = DiningTable(company_id=company_id, branch_id=branch_id, name=name, capacity=capacity, table_type=table_type, sort_order=sort_order)
        self.db.add(table)
        await self.db.commit()
        await self.db.refresh(table)
        return table

    async def update_table(self, table: DiningTable, **kwargs) -> DiningTable:
        for key, val in kwargs.items():
            if val is not None and hasattr(table, key):
                setattr(table, key, val)
        await self.db.commit()
        await self.db.refresh(table)
        return table

    # ── Sessions ──────────────────────────────────────────────────────────────

    async def _next_queue_number(self, branch_id: uuid.UUID, reset: str = "daily") -> tuple[int, str]:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        filter_date = today if reset == "daily" else None
        q = select(func.max(DiningSession.queue_number)).where(
            DiningSession.branch_id == branch_id,
            DiningSession.queue_number.isnot(None),
        )
        if filter_date:
            q = q.where(DiningSession.queue_date == filter_date)
        last = await self.db.scalar(q)
        return (last or 0) + 1, today

    async def open_session(
        self,
        company_id: uuid.UUID,
        branch_id: uuid.UUID,
        payload: SessionOpen,
        opened_by: uuid.UUID | None = None,
        settings: BranchSettings | None = None,
    ) -> DiningSession:
        queue_num: int | None = None
        queue_date: str | None = None

        if settings and settings.fb_queue_enabled:
            reset = settings.fb_queue_reset if settings else "daily"
            queue_num, queue_date = await self._next_queue_number(branch_id, reset)

        session = DiningSession(
            company_id=company_id,
            branch_id=branch_id,
            table_id=payload.table_id,
            opened_by=opened_by,
            queue_number=queue_num,
            queue_date=queue_date,
            guest_count=payload.guest_count,
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
        )
        self.db.add(session)

        if payload.table_id:
            table = await self.db.get(DiningTable, payload.table_id)
            if table:
                table.status = "occupied"

        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def get_session(self, session_id: uuid.UUID) -> DiningSession | None:
        return await self.db.scalar(
            select(DiningSession)
            .options(selectinload(DiningSession.orders).selectinload(DiningOrder.items))
            .where(DiningSession.id == session_id)
        )

    async def get_open_session_by_table(self, table_id: uuid.UUID) -> DiningSession | None:
        return await self.db.scalar(
            select(DiningSession)
            .options(selectinload(DiningSession.orders).selectinload(DiningOrder.items))
            .where(DiningSession.table_id == table_id, DiningSession.status == "open")
        )

    async def request_bill(self, session: DiningSession) -> DiningSession:
        session.status = "bill_requested"
        if session.table_id:
            table = await self.db.get(DiningTable, session.table_id)
            if table:
                table.status = "bill_requested"
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def close_session(self, session: DiningSession, sale_order_id: uuid.UUID | None = None) -> DiningSession:
        session.status = "closed"
        session.closed_at = datetime.now(timezone.utc)
        if sale_order_id:
            session.sale_order_id = sale_order_id
        if session.table_id:
            table = await self.db.get(DiningTable, session.table_id)
            if table:
                table.status = "available"
        await self.db.commit()
        await self.db.refresh(session)
        return session

    # ── Orders ────────────────────────────────────────────────────────────────

    async def _get_product(self, product_id: uuid.UUID) -> Product | None:
        return await self.db.get(Product, product_id)

    async def _resolve_station(self, product: Product, settings: BranchSettings | None) -> str | None:
        stations = settings.fb_kitchen_stations if settings and settings.fb_kitchen_stations else []
        if not stations:
            return None
        # ลอง match ชื่อ category กับ station
        if product.category_id:
            cat = await self.db.get(Category, product.category_id)
            if cat:
                cat_name = cat.name.lower()
                for station in stations:
                    if any(kw in cat_name for kw in station.lower().split()):
                        return station
        return stations[0] if stations else None

    async def place_order(
        self,
        company_id: uuid.UUID,
        branch_id: uuid.UUID,
        session: DiningSession,
        payload: PlaceOrderRequest,
        source: str = "qr_self",
        settings: BranchSettings | None = None,
    ) -> DiningOrder:
        from app.models.branch import Branch as BranchModel
        branch = await self.db.get(BranchModel, branch_id)
        table = await self.db.get(DiningTable, session.table_id) if session.table_id else None

        ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        order_number = f"DO-{ts[-8:]}-{str(session.id)[:4].upper()}"

        order = DiningOrder(
            company_id=company_id, branch_id=branch_id,
            session_id=session.id, order_number=order_number,
            source=source, note=payload.note,
        )
        self.db.add(order)
        await self.db.flush()

        for item_data in payload.items:
            product = await self._get_product(item_data.product_id)
            if not product:
                continue
            station = await self._resolve_station(product, settings)
            item = DiningOrderItem(
                order_id=order.id,
                product_id=product.id,
                product_name=product.name,
                qty=item_data.qty,
                unit_price=product.selling_price,
                special_request=item_data.special_request,
                station=station,
            )
            self.db.add(item)
            await self.db.flush()

            ticket = KitchenTicket(
                company_id=company_id,
                branch_id=branch_id,
                session_id=session.id,
                order_item_id=item.id,
                product_name=product.name,
                qty=item_data.qty,
                special_request=item_data.special_request,
                station=station,
                queue_number=session.queue_number,
                table_name=table.name if table else None,
            )
            self.db.add(ticket)

        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ── Kitchen ───────────────────────────────────────────────────────────────

    async def list_kitchen_tickets(
        self,
        branch_id: uuid.UUID,
        station: str | None = None,
        status: str | None = None,
    ) -> list[KitchenTicket]:
        q = select(KitchenTicket).where(KitchenTicket.branch_id == branch_id)
        if station:
            q = q.where(KitchenTicket.station == station)
        if status:
            q = q.where(KitchenTicket.status == status)
        else:
            q = q.where(KitchenTicket.status.in_(["pending", "cooking", "done"]))
        q = q.order_by(KitchenTicket.created_at)
        return list((await self.db.scalars(q)).all())

    async def update_ticket_status(self, ticket: KitchenTicket, new_status: str) -> KitchenTicket:
        self._validate_ticket_transition(ticket.status, new_status)
        ticket.status = new_status
        if new_status == "done":
            ticket.done_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(ticket)

        # sync order item status
        item = await self.db.get(DiningOrderItem, ticket.order_item_id)
        if item:
            item.status = new_status
            await self.db.commit()

        # ส่ง Line Notify เมื่อ done — ตรวจว่าทุก ticket ใน session เสร็จหมดแล้ว
        if new_status == "done":
            await self._notify_pickup_if_ready(ticket)

        return ticket

    async def update_order_item_status(self, item: DiningOrderItem, new_status: str) -> DiningOrderItem:
        ticket = await self.db.scalar(
            select(KitchenTicket).where(KitchenTicket.order_item_id == item.id)
        )
        if ticket:
            await self.update_ticket_status(ticket, new_status)
            await self.db.refresh(item)
            return item

        self._validate_ticket_transition(item.status, new_status)
        item.status = new_status
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def cancel_order_item(self, item: DiningOrderItem, reason: str) -> DiningOrderItem:
        if item.status == "served":
            raise ValueError("รายการนี้เสิร์ฟแล้ว ไม่สามารถยกเลิกได้")
        if item.status == "cancelled":
            return item

        clean_reason = reason.strip()
        item.status = "cancelled"
        item.special_request = f"{item.special_request or ''}\nยกเลิก: {clean_reason}".strip()

        ticket = await self.db.scalar(
            select(KitchenTicket).where(KitchenTicket.order_item_id == item.id)
        )
        if ticket:
            ticket.status = "cancelled"

        order = await self.db.get(DiningOrder, item.order_id)
        if order:
            items = (await self.db.scalars(
                select(DiningOrderItem).where(DiningOrderItem.order_id == order.id)
            )).all()
            if all(row.status == "cancelled" for row in items):
                order.status = "cancelled"
                order.note = f"{order.note or ''}\nยกเลิก: {clean_reason}".strip()

        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def cancel_order(self, order: DiningOrder, reason: str) -> DiningOrder:
        if order.status == "cancelled":
            return order

        items = (await self.db.scalars(
            select(DiningOrderItem).where(DiningOrderItem.order_id == order.id)
        )).all()
        if any(item.status == "served" for item in items):
            raise ValueError("มีรายการที่เสิร์ฟแล้ว ไม่สามารถยกเลิกทั้งออเดอร์ได้")

        clean_reason = reason.strip()
        order.status = "cancelled"
        order.note = f"{order.note or ''}\nยกเลิก: {clean_reason}".strip()
        for item in items:
            item.status = "cancelled"
            item.special_request = f"{item.special_request or ''}\nยกเลิก: {clean_reason}".strip()

        tickets = (await self.db.scalars(
            select(KitchenTicket).where(KitchenTicket.order_item_id.in_([item.id for item in items]))
        )).all() if items else []
        for ticket in tickets:
            ticket.status = "cancelled"

        await self.db.commit()
        await self.db.refresh(order)
        return order

    async def _notify_pickup_if_ready(self, done_ticket: KitchenTicket) -> None:
        """ส่ง Line Notify เมื่อทุกรายการใน session พร้อมหมดแล้ว"""
        # ตรวจว่ายังมี ticket ที่ยัง pending/cooking ใน session เดียวกันไหม
        remaining = await self.db.scalar(
            select(func.count(KitchenTicket.id)).where(
                KitchenTicket.session_id == done_ticket.session_id,
                KitchenTicket.status.in_(["pending", "cooking"]),
            )
        )
        if remaining and remaining > 0:
            return  # ยังมีรายการที่ยังทำอยู่

        # ดึง settings ของสาขา
        settings = await self.db.scalar(
            select(BranchSettings).where(BranchSettings.branch_id == done_ticket.branch_id)
        )
        if not settings or not settings.fb_line_notify_token:
            return

        # สร้างข้อความ
        session = await self.db.get(DiningSession, done_ticket.session_id)
        if not session:
            return

        prefix = settings.fb_queue_prefix or ""
        if session.queue_number:
            queue_str = f"{prefix}{str(session.queue_number).zfill(3)}"
            message = f"\n🍽️ ออเดอร์พร้อมแล้ว!\nคิว {queue_str} — มารับได้เลยครับ 🔔"
        else:
            table = await self.db.get(DiningTable, session.table_id) if session.table_id else None
            table_name = table.name if table else "ของคุณ"
            message = f"\n🍽️ ออเดอร์พร้อมแล้ว!\nโต๊ะ {table_name} — พร้อมเสิร์ฟครับ 🔔"

        # ดึง company_id จาก branch
        branch = await self.db.get(Branch, done_ticket.branch_id)
        if not branch:
            return

        try:
            notif_svc = NotificationService(self.db)
            await notif_svc.send_line_notify(
                token=settings.fb_line_notify_token,
                message=message,
                company_id=branch.company_id,
                event_type="fb_order_ready",
                reference_type="dining_session",
                reference_id=str(session.id),
            )
        except Exception:
            pass  # notification ไม่ควร block การทำงานหลัก

    async def get_ready_pickup_queues(self, branch_id: uuid.UUID) -> list[dict[str, object]]:
        """คิว Quick Service ที่อาหารพร้อมทุกรายการแล้ว (สำหรับหน้าจอ Pickup Display)"""
        done_sessions = await self.db.scalars(
            select(KitchenTicket.session_id)
            .where(KitchenTicket.branch_id == branch_id, KitchenTicket.status == "done")
            .distinct()
        )
        done_set = set(done_sessions.all())
        if not done_set:
            return []

        pending_sessions = await self.db.scalars(
            select(KitchenTicket.session_id)
            .where(KitchenTicket.branch_id == branch_id, KitchenTicket.status.in_(["pending", "cooking"]))
            .distinct()
        )
        still_cooking = set(pending_sessions.all())
        fully_done = done_set - still_cooking

        if not fully_done:
            return []

        sessions = list((await self.db.scalars(
            select(DiningSession)
            .where(
                DiningSession.id.in_(fully_done),
                DiningSession.queue_number.isnot(None),
                DiningSession.table_id.is_(None),
                DiningSession.status == "open",
            )
            .order_by(DiningSession.queue_number)
        )).all())

        result: list[dict[str, object]] = []
        for session in sessions:
            stats = await self.db.execute(
                select(func.count(KitchenTicket.id), func.coalesce(func.sum(KitchenTicket.qty), 0), func.max(KitchenTicket.done_at))
                .where(KitchenTicket.session_id == session.id, KitchenTicket.status == "done")
            )
            ticket_count, item_count, ready_at = stats.one()
            result.append({
                "session_id": str(session.id),
                "queue_number": session.queue_number,
                "customer_name": session.customer_name,
                "ticket_count": int(ticket_count or 0),
                "item_count": int(item_count or 0),
                "ready_at": ready_at.isoformat() if ready_at else None,
            })
        return result

    async def get_ready_queue_numbers(self, branch_id: uuid.UUID) -> list[int]:
        """Backward-compatible list of ready Quick Service queue numbers."""
        queues = await self.get_ready_pickup_queues(branch_id)
        return [int(item["queue_number"]) for item in queues if item.get("queue_number") is not None]

    # ── Public Menu (QR) ──────────────────────────────────────────────────────

    async def get_public_menu(self, qr_token: uuid.UUID) -> PublicMenuResponse | None:
        table = await self.get_table_by_token(qr_token)
        if not table:
            return None

        branch = await self.db.get(Branch, table.branch_id)
        if not branch:
            return None

        settings = await self.db.scalar(
            select(BranchSettings).where(BranchSettings.branch_id == table.branch_id)
        )

        active_session = await self.get_open_session_by_table(table.id)

        products_rows = (await self.db.scalars(
            select(Product)
            .where(
                Product.company_id == table.company_id,
                Product.product_type == "menu_item",
                Product.is_active.is_(True),
                Product.is_for_sale.is_(True),
            )
            .order_by(Product.name)
        )).all()

        categories_raw = (await self.db.scalars(
            select(Category).where(Category.company_id == table.company_id, Category.is_active.is_(True))
        )).all()

        cat_map = {c.id: c.name for c in categories_raw}
        categories = [{"id": str(c.id), "name": c.name} for c in categories_raw]

        products = [
            PublicMenuProduct(
                id=p.id,
                name=p.name,
                description=p.description,
                selling_price=p.selling_price,
                category_id=p.category_id,
                category_name=cat_map.get(p.category_id) if p.category_id else None,
                image_url=p.image_url,
                is_available=True,
            )
            for p in products_rows
        ]

        return PublicMenuResponse(
            session_id=active_session.id if active_session else None,
            queue_number=active_session.queue_number if active_session else None,
            table_name=table.name,
            branch_name=branch.name,
            fb_service_mode=settings.fb_service_mode if settings else "dine_in",
            categories=categories,
            products=products,
            session_status=active_session.status if active_session else None,
        )

    async def _resolve_shift_and_location(
        self,
        company_id: uuid.UUID,
        branch_id: uuid.UUID,
        user_id: uuid.UUID,
        shift_id: uuid.UUID | None,
        location_id: uuid.UUID | None,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """หา shift และ location อัตโนมัติถ้าไม่ได้ระบุ"""
        # 1. ลอง shift ของ user นี้ก่อน
        resolved_shift: CashierShift | None = None
        if shift_id:
            resolved_shift = await self.db.scalar(
                select(CashierShift).where(
                    CashierShift.id == shift_id,
                    CashierShift.company_id == company_id,
                    CashierShift.status == "open",
                )
            )

        # 2. ถ้าไม่มี → หา open shift ของ user นี้
        if not resolved_shift:
            resolved_shift = await self.db.scalar(
                select(CashierShift).where(
                    CashierShift.company_id == company_id,
                    CashierShift.branch_id == branch_id,
                    CashierShift.user_id == user_id,
                    CashierShift.status == "open",
                )
            )

        # 3. ถ้ายังไม่มี → หา shift ของสาขา (user อื่นก็ได้)
        if not resolved_shift:
            resolved_shift = await self.db.scalar(
                select(CashierShift).where(
                    CashierShift.company_id == company_id,
                    CashierShift.branch_id == branch_id,
                    CashierShift.status == "open",
                ).order_by(CashierShift.opened_at.desc()).limit(1)
            )

        # 4. ถ้ายังไม่มีเลย → auto-create F&B shift
        if not resolved_shift:
            # ตรวจ user นี้มี open shift อยู่แล้วไหม (ก่อน create เพื่อหลีกเลี่ยง unique constraint)
            existing_user_shift = await self.db.scalar(
                select(CashierShift).where(
                    CashierShift.company_id == company_id,
                    CashierShift.user_id == user_id,
                    CashierShift.status == "open",
                )
            )
            if existing_user_shift:
                resolved_shift = existing_user_shift
            else:
                # หา location แรกของสาขา
                first_location = await self.db.scalar(
                    select(StockLocation).where(
                        StockLocation.company_id == company_id,
                        StockLocation.branch_id == branch_id,
                        StockLocation.is_active.is_(True),
                        StockLocation.deleted_at.is_(None),
                    ).order_by(StockLocation.created_at).limit(1)
                )
                if not first_location:
                    raise ValueError("ไม่พบ Stock Location สำหรับสาขานี้ กรุณาสร้าง Location ก่อน")

                resolved_shift = CashierShift(
                    company_id=company_id,
                    branch_id=branch_id,
                    user_id=user_id,
                    location_id=first_location.id,
                    opening_cash=Decimal("0"),
                    shift_number=f"FB-AUTO-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
                )
                self.db.add(resolved_shift)
                await self.db.flush()

        resolved_location_id = location_id or resolved_shift.location_id
        return resolved_shift.id, resolved_location_id

    async def checkout_session(
        self,
        session: DiningSession,
        company_id: uuid.UUID,
        branch_id: uuid.UUID,
        user_id: uuid.UUID,
        payload: SessionCheckoutRequest,
    ) -> SessionCheckoutResult:
        from app.services.sale_service import SaleService

        # resolve shift + location (auto-detect ถ้าไม่ได้ระบุ)
        resolved_shift_id, resolved_location_id = await self._resolve_shift_and_location(
            company_id, branch_id, user_id,
            payload.shift_id, payload.location_id,
        )

        # รวบรวม order items ทั้งหมดจาก session
        await self.db.refresh(session)
        full_session = await self.get_session(session.id)
        if not full_session:
            raise ValueError("Session not found")

        all_items: list[DiningOrderItem] = []
        for order in full_session.orders:
            if order.status != "cancelled":
                all_items.extend([item for item in order.items if item.status != "cancelled"])

        if not all_items:
            raise ValueError("ไม่มีรายการอาหารในออเดอร์นี้")

        # สร้าง CartItems พร้อม vat info จาก Product
        cart_items: list[CartItem] = []
        for item in all_items:
            product = await self.db.get(Product, item.product_id)
            vat_type = product.vat_type if product else "included"
            vat_rate = Decimal(str(product.vat_rate)) if product else Decimal("7")
            cart_items.append(CartItem(
                product_id=item.product_id,
                variant_id=None,
                qty=Decimal(item.qty),
                unit_price=item.unit_price,
                original_price=item.unit_price,
                discount_amount=Decimal("0"),
                discount_type="amount",
                vat_type=vat_type,
                vat_rate=vat_rate,
            ))

        # สร้าง payment rows
        payment_rows: list[PaymentCreateRequest] = []
        if payload.payments:
            for p in payload.payments:
                payment_rows.append(PaymentCreateRequest(
                    payment_method=p.get("payment_method", payload.payment_method),
                    amount=Decimal(str(p.get("amount", 0))),
                    reference_no=p.get("reference_no"),
                ))
        else:
            payment_rows.append(PaymentCreateRequest(
                payment_method=payload.payment_method,
                amount=payload.paid_amount,
                reference_no=None,
            ))

        # customer info — fallback จาก session
        customer_name = payload.customer_name or session.customer_name
        customer_phone = payload.customer_phone or session.customer_phone

        note_parts = ["F&B"]
        source_type = "quick_service" if session.table_id is None else "dine_in"
        note_parts.append("Quick Service" if source_type == "quick_service" else "Dine-in")
        if session.queue_number:
            note_parts.append(f"คิว {str(session.queue_number).zfill(3)}")
        table = await self.db.get(DiningTable, session.table_id) if session.table_id else None
        if table:
            note_parts.append(f"โต๊ะ {table.name}")
        if payload.note:
            note_parts.append(payload.note)

        create_request = CreateSaleRequest(
            shift_id=resolved_shift_id,
            location_id=resolved_location_id,
            items=cart_items,
            discount_amount=payload.discount_amount,
            discount_type="amount",
            payment_method=payload.payment_method,
            payments=payment_rows,
            paid_amount=payload.paid_amount,
            customer_name=customer_name,
            customer_phone=customer_phone,
            customer_tax_id=payload.customer_tax_id,
            customer_id=payload.customer_id,
            note=" | ".join(note_parts) if note_parts else None,
        )

        sale_svc = SaleService(self.db)
        sale_order = await sale_svc.create_sale(company_id, branch_id, user_id, create_request)

        # ปิด session
        await self.close_session(session, sale_order_id=sale_order.id)

        return SessionCheckoutResult(
            sale_order_id=sale_order.id,
            order_number=sale_order.order_number,
            total_amount=sale_order.total_amount,
            paid_amount=sale_order.paid_amount,
            change_amount=sale_order.change_amount,
            session_id=session.id,
            table_name=table.name if table else None,
            queue_number=session.queue_number,
            source_type=source_type,
            customer_name=customer_name,
            customer_phone=customer_phone,
            payment_method=payload.payment_method,
            note=sale_order.note,
        )

    async def get_public_order_status(self, session_id: uuid.UUID) -> PublicOrderStatus | None:
        session = await self.get_session(session_id)
        if not session:
            return None
        items: list[DiningOrderItemRead] = []
        for order in session.orders:
            for item in order.items:
                items.append(DiningOrderItemRead(
                    id=item.id,
                    product_id=item.product_id,
                    product_name=item.product_name,
                    qty=item.qty,
                    unit_price=item.unit_price,
                    special_request=item.special_request,
                    status=item.status,
                ))
        return PublicOrderStatus(
            session_id=session.id,
            queue_number=session.queue_number,
            session_status=session.status,
            items=items,
        )
