from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import uuid
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import case, distinct, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.audit import AuditLog
from app.models.branch import Branch
from app.models.product import Product, ProductVariant
from app.models.stock import StockBalance, StockLocation
from app.models.transfer import TransferOrder, TransferOrderItem
from app.models.user import User
from app.schemas.stock import TransferItem, TransferRequest
from app.schemas.transfer import (
    ApproveTORequest,
    BranchStockSummary,
    CreateTORequest,
    MultiBranchStockResponse,
    ReceiveTORequest,
    ShipTORequest,
)
from app.services.stock_service import StockService

TWOPLACES = Decimal("0.01")
FOURPLACES = Decimal("0.0001")
BANGKOK = ZoneInfo("Asia/Bangkok")


def q4(value: Decimal | int | float | None) -> Decimal:
    return Decimal(value or 0).quantize(FOURPLACES, rounding=ROUND_HALF_UP)


class TransferService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.stock_service = StockService(db)

    async def create_to(
        self, company_id: uuid.UUID, user_id: uuid.UUID, data: CreateTORequest
    ) -> TransferOrder:
        if data.from_location_id == data.to_location_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and destination locations must be different")
        if not data.items:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one item is required")

        from_branch = await self._get_branch(company_id, data.from_branch_id)
        to_branch = await self._get_branch(company_id, data.to_branch_id)
        from_location = await self.stock_service._get_location(data.from_location_id, company_id)
        to_location = await self.stock_service._get_location(data.to_location_id, company_id)
        if from_location.branch_id != from_branch.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source location does not belong to source branch")
        if to_location.branch_id != to_branch.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Destination location does not belong to destination branch")

        prepared_items = await self._prepare_items(company_id, data.items)
        to_number = await self._generate_number(company_id, data.expected_date or datetime.now(BANGKOK).date())
        transfer_order = TransferOrder(
            company_id=company_id,
            to_number=to_number,
            status="draft",
            from_branch_id=from_branch.id,
            to_branch_id=to_branch.id,
            from_location_id=from_location.id,
            to_location_id=to_location.id,
            requested_by=user_id,
            request_date=datetime.now(BANGKOK).date(),
            expected_date=data.expected_date,
            note=data.note,
        )
        self.db.add(transfer_order)
        await self.db.flush()
        self.db.add_all(
            [
                TransferOrderItem(
                    to_id=transfer_order.id,
                    company_id=company_id,
                    product_id=item["product_id"],
                    variant_id=item["variant_id"],
                    product_name=item["product_name"],
                    sku=item["sku"],
                    unit_code=item["unit_code"],
                    qty_requested=item["qty_requested"],
                )
                for item in prepared_items
            ]
        )
        self._audit(company_id, user_id, "inventory.transfer.create", str(transfer_order.id), {"to_number": to_number})
        await self.db.commit()
        return await self.get_to(transfer_order.id, company_id)

    async def submit_to(
        self, to_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID
    ) -> TransferOrder:
        transfer_order = await self._get_to_entity(to_id, company_id)
        if transfer_order.status != "draft":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft transfer orders can be submitted")

        for item in transfer_order.items:
            balance = await self.stock_service._get_or_create_balance(
                company_id=company_id,
                branch_id=transfer_order.from_branch_id,
                location_id=transfer_order.from_location_id,
                product_id=item.product_id,
                variant_id=item.variant_id,
            )
            if Decimal(balance.qty_available or 0) < Decimal(item.qty_requested):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Insufficient stock for {item.product_name}",
                )

        transfer_order.status = "pending_approval"
        self._audit(company_id, user_id, "inventory.transfer.submit", str(transfer_order.id))
        await self.db.commit()
        return await self.get_to(transfer_order.id, company_id)

    async def approve_to(
        self, to_id: uuid.UUID, company_id: uuid.UUID, approver_id: uuid.UUID, data: ApproveTORequest
    ) -> TransferOrder:
        transfer_order = await self._get_to_entity(to_id, company_id)
        if transfer_order.status != "pending_approval":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only pending transfer orders can be approved")

        approve_map = {item.item_id: item for item in data.items}
        if set(approve_map.keys()) != {item.id for item in transfer_order.items}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval items must match transfer order items")

        for item in transfer_order.items:
            approved_qty = q4(approve_map[item.id].qty_approved)
            if approved_qty <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approved quantity must be positive")
            if approved_qty > Decimal(item.qty_requested):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approved quantity cannot exceed requested quantity")
            balance = await self.stock_service._get_or_create_balance(
                company_id=company_id,
                branch_id=transfer_order.from_branch_id,
                location_id=transfer_order.from_location_id,
                product_id=item.product_id,
                variant_id=item.variant_id,
            )
            if Decimal(balance.qty_available or 0) < approved_qty:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Insufficient stock for {item.product_name}")
            balance.qty_reserved = q4(Decimal(balance.qty_reserved or 0) + approved_qty)
            item.qty_approved = approved_qty

        transfer_order.status = "approved"
        transfer_order.approved_by = approver_id
        transfer_order.approved_at = datetime.now(timezone.utc)
        if data.note:
            transfer_order.note = "\n".join(filter(None, [transfer_order.note, data.note]))
        self._audit(company_id, approver_id, "inventory.transfer.approve", str(transfer_order.id))
        await self.db.commit()
        return await self.get_to(transfer_order.id, company_id)

    async def ship_to(
        self, to_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID, data: ShipTORequest
    ) -> TransferOrder:
        transfer_order = await self._get_to_entity(to_id, company_id)
        if transfer_order.status != "approved":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only approved transfer orders can be shipped")

        transfer_items: list[TransferItem] = []
        for item in transfer_order.items:
            qty = Decimal(item.qty_approved or 0)
            if qty <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Missing approved quantity for {item.product_name}")
            transfer_items.append(TransferItem(product_id=item.product_id, variant_id=item.variant_id, qty=qty))

        await self.stock_service.transfer(
            company_id=company_id,
            user_id=user_id,
            data=TransferRequest(
                from_location_id=transfer_order.from_location_id,
                to_location_id=transfer_order.to_location_id,
                items=transfer_items,
                note=data.note or transfer_order.note,
            ),
        )

        refreshed = await self._get_to_entity(to_id, company_id)
        for item in refreshed.items:
            balance = await self.stock_service._get_or_create_balance(
                company_id=company_id,
                branch_id=refreshed.from_branch_id,
                location_id=refreshed.from_location_id,
                product_id=item.product_id,
                variant_id=item.variant_id,
            )
            approved_qty = Decimal(item.qty_approved or 0)
            balance.qty_reserved = q4(max(Decimal("0"), Decimal(balance.qty_reserved or 0) - approved_qty))
            item.qty_sent = approved_qty

        refreshed.status = "in_transit"
        refreshed.shipped_at = datetime.now(timezone.utc)
        if data.note:
            refreshed.note = "\n".join(filter(None, [refreshed.note, data.note]))
        self._audit(company_id, user_id, "inventory.transfer.ship", str(refreshed.id))
        await self.db.commit()
        return await self.get_to(refreshed.id, company_id)

    async def receive_to(
        self, to_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID, data: ReceiveTORequest
    ) -> TransferOrder:
        transfer_order = await self._get_to_entity(to_id, company_id)
        if transfer_order.status != "in_transit":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only in-transit transfer orders can be received")

        receive_map = {item.item_id: item for item in data.items}
        if set(receive_map.keys()) != {item.id for item in transfer_order.items}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Receive items must match transfer order items")

        discrepancies: list[str] = []
        for item in transfer_order.items:
            qty_received = q4(receive_map[item.id].qty_received)
            qty_sent = Decimal(item.qty_sent or 0)
            if qty_received < 0 or qty_received > qty_sent:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid received quantity for {item.product_name}")
            item.qty_received = qty_received
            if qty_received < qty_sent:
                discrepancies.append(f"รับสินค้าไม่ครบ: {item.product_name} ส่ง {qty_sent} รับ {qty_received}")

        transfer_order.status = "completed"
        transfer_order.received_by = user_id
        transfer_order.completed_at = datetime.now(timezone.utc)
        notes = [transfer_order.note, data.note, *discrepancies]
        transfer_order.note = "\n".join([note for note in notes if note])
        self._audit(company_id, user_id, "inventory.transfer.receive", str(transfer_order.id))
        await self.db.commit()
        return await self.get_to(transfer_order.id, company_id)

    async def cancel_to(
        self, to_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID, reason: str
    ) -> TransferOrder:
        transfer_order = await self._get_to_entity(to_id, company_id)
        if transfer_order.status not in {"draft", "pending_approval", "approved"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Transfer order cannot be cancelled")

        if transfer_order.status == "approved":
            for item in transfer_order.items:
                approved_qty = Decimal(item.qty_approved or 0)
                if approved_qty <= 0:
                    continue
                balance = await self.stock_service._get_or_create_balance(
                    company_id=company_id,
                    branch_id=transfer_order.from_branch_id,
                    location_id=transfer_order.from_location_id,
                    product_id=item.product_id,
                    variant_id=item.variant_id,
                )
                balance.qty_reserved = q4(max(Decimal("0"), Decimal(balance.qty_reserved or 0) - approved_qty))

        transfer_order.status = "cancelled"
        transfer_order.cancelled_at = datetime.now(timezone.utc)
        transfer_order.cancel_reason = reason
        self._audit(company_id, user_id, "inventory.transfer.cancel", str(transfer_order.id), {"reason": reason})
        await self.db.commit()
        return await self.get_to(transfer_order.id, company_id)

    async def get_to(self, to_id: uuid.UUID, company_id: uuid.UUID) -> TransferOrder:
        transfer_order = await self._get_to_entity(to_id, company_id)
        self._apply_names(transfer_order)
        return transfer_order

    async def list_tos(
        self,
        company_id: uuid.UUID,
        from_branch_id: uuid.UUID | None = None,
        to_branch_id: uuid.UUID | None = None,
        status_value: str | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> tuple[list[TransferOrder], int]:
        filters = [TransferOrder.company_id == company_id]
        if from_branch_id is not None:
            filters.append(TransferOrder.from_branch_id == from_branch_id)
        if to_branch_id is not None:
            filters.append(TransferOrder.to_branch_id == to_branch_id)
        if status_value:
            filters.append(TransferOrder.status == status_value)

        total = await self.db.scalar(select(func.count(TransferOrder.id)).where(*filters)) or 0
        rows = await self.db.scalars(
            select(TransferOrder)
            .where(*filters)
            .options(
                selectinload(TransferOrder.items),
                selectinload(TransferOrder.from_branch),
                selectinload(TransferOrder.to_branch),
                selectinload(TransferOrder.from_location),
                selectinload(TransferOrder.to_location),
                selectinload(TransferOrder.requester),
            )
            .order_by(TransferOrder.request_date.desc(), TransferOrder.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
        orders = rows.unique().all()
        for order in orders:
            self._apply_names(order)
        return orders, int(total)

    async def get_multi_branch_stock(
        self, company_id: uuid.UUID
    ) -> MultiBranchStockResponse:
        location_counts = (
            select(
                StockLocation.branch_id.label("branch_id"),
                func.count(distinct(StockLocation.id)).label("location_count"),
            )
            .where(StockLocation.company_id == company_id, StockLocation.deleted_at.is_(None))
            .group_by(StockLocation.branch_id)
            .subquery()
        )
        balance_summary = (
            select(
                StockBalance.branch_id.label("branch_id"),
                func.count(
                    distinct(case((StockBalance.qty_on_hand > 0, StockBalance.product_id)))
                ).label("product_count"),
                func.coalesce(
                    func.sum(StockBalance.qty_on_hand * StockBalance.cost_per_unit), 0
                ).label("total_value"),
                func.count(
                    distinct(
                        case(
                            (
                                (Product.min_stock_qty > 0)
                                & (StockBalance.qty_on_hand <= Product.min_stock_qty),
                                StockBalance.id,
                            )
                        )
                    )
                ).label("low_stock_count"),
                func.count(
                    distinct(case((StockBalance.qty_on_hand == 0, StockBalance.id)))
                ).label("zero_stock_count"),
            )
            .select_from(StockBalance)
            .join(Product, Product.id == StockBalance.product_id)
            .where(StockBalance.company_id == company_id)
            .group_by(StockBalance.branch_id)
            .subquery()
        )
        statement = (
            select(
                Branch.id,
                Branch.name,
                func.coalesce(location_counts.c.location_count, 0),
                func.coalesce(balance_summary.c.product_count, 0),
                func.coalesce(balance_summary.c.total_value, 0),
                func.coalesce(balance_summary.c.low_stock_count, 0),
                func.coalesce(balance_summary.c.zero_stock_count, 0),
            )
            .select_from(Branch)
            .join(location_counts, location_counts.c.branch_id == Branch.id, isouter=True)
            .join(balance_summary, balance_summary.c.branch_id == Branch.id, isouter=True)
            .where(Branch.company_id == company_id, Branch.deleted_at.is_(None))
            .order_by(Branch.sort_order.asc(), Branch.name.asc())
        )
        rows = await self.db.execute(statement)
        branches: list[BranchStockSummary] = []
        grand_total_value = Decimal("0")
        grand_low_stock_count = 0
        for branch_id, branch_name, location_count, product_count, total_value, low_stock_count, zero_stock_count in rows.all():
            total_value_decimal = Decimal(total_value or 0).quantize(TWOPLACES, rounding=ROUND_HALF_UP)
            branches.append(
                BranchStockSummary(
                    branch_id=str(branch_id),
                    branch_name=branch_name,
                    location_count=int(location_count or 0),
                    product_count=int(product_count or 0),
                    total_value=total_value_decimal,
                    low_stock_count=int(low_stock_count or 0),
                    zero_stock_count=int(zero_stock_count or 0),
                )
            )
            grand_total_value += total_value_decimal
            grand_low_stock_count += int(low_stock_count or 0)
        return MultiBranchStockResponse(
            branches=branches,
            grand_total_value=grand_total_value.quantize(TWOPLACES, rounding=ROUND_HALF_UP),
            grand_low_stock_count=grand_low_stock_count,
        )

    async def _get_branch(self, company_id: uuid.UUID, branch_id: uuid.UUID) -> Branch:
        branch = await self.db.scalar(
            select(Branch).where(Branch.id == branch_id, Branch.company_id == company_id, Branch.deleted_at.is_(None))
        )
        if branch is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
        return branch

    async def _prepare_items(self, company_id: uuid.UUID, items) -> list[dict[str, object]]:
        prepared: list[dict[str, object]] = []
        for item in items:
            if item.qty_requested <= 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested quantity must be positive")
            product = await self.db.scalar(
                select(Product)
                .where(Product.id == item.product_id, Product.company_id == company_id, Product.deleted_at.is_(None))
                .options(selectinload(Product.unit))
            )
            if product is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
            variant = None
            if item.variant_id is not None:
                variant = await self.db.scalar(
                    select(ProductVariant).where(
                        ProductVariant.id == item.variant_id,
                        ProductVariant.company_id == company_id,
                        ProductVariant.product_id == product.id,
                        ProductVariant.deleted_at.is_(None),
                    )
                )
                if variant is None:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Variant not found")
            prepared.append(
                {
                    "product_id": product.id,
                    "variant_id": variant.id if variant else None,
                    "product_name": product.name if variant is None else f"{product.name} - {variant.name}",
                    "sku": variant.sku if variant else product.sku,
                    "unit_code": product.unit.code if product.unit else None,
                    "qty_requested": q4(item.qty_requested),
                }
            )
        return prepared

    async def _generate_number(self, company_id: uuid.UUID, target_date: date) -> str:
        day_prefix = f"TO{target_date:%Y%m%d}-"
        lock_key = hash(str(company_id) + target_date.strftime("%Y%m%d") + "TRANSFER") % (2**31)
        await self.db.execute(text(f"SELECT pg_advisory_xact_lock({lock_key})"))
        count = await self.db.scalar(
            select(func.count(TransferOrder.id)).where(
                TransferOrder.company_id == company_id,
                TransferOrder.to_number.like(f"{day_prefix}%"),
            )
        ) or 0
        return f"{day_prefix}{int(count) + 1:04d}"

    async def _get_to_entity(self, to_id: uuid.UUID, company_id: uuid.UUID) -> TransferOrder:
        transfer_order = await self.db.scalar(
            select(TransferOrder)
            .where(TransferOrder.id == to_id, TransferOrder.company_id == company_id)
            .options(
                selectinload(TransferOrder.items),
                selectinload(TransferOrder.from_branch),
                selectinload(TransferOrder.to_branch),
                selectinload(TransferOrder.from_location),
                selectinload(TransferOrder.to_location),
                selectinload(TransferOrder.requester),
                selectinload(TransferOrder.approver),
                selectinload(TransferOrder.receiver),
            )
        )
        if transfer_order is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer order not found")
        return transfer_order

    def _apply_names(self, transfer_order: TransferOrder) -> None:
        transfer_order.from_branch_name = transfer_order.from_branch.name
        transfer_order.to_branch_name = transfer_order.to_branch.name
        transfer_order.from_location_name = transfer_order.from_location.name
        transfer_order.to_location_name = transfer_order.to_location.name
        transfer_order.requested_by_name = transfer_order.requester.display_name or transfer_order.requester.username
        transfer_order.item_count = len(transfer_order.items)

    def _audit(
        self,
        company_id: uuid.UUID,
        user_id: uuid.UUID,
        action: str,
        resource_id: str,
        new_value: dict | None = None,
    ) -> None:
        self.db.add(
            AuditLog(
                company_id=company_id,
                user_id=user_id,
                action=action,
                resource="TransferOrder",
                resource_id=resource_id,
                new_value=new_value,
            )
        )
