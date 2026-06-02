from __future__ import annotations

from datetime import date, datetime
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import TokenData, require_permission
from app.models.restaurant import DiningTable, DiningSession, DiningOrder, DiningOrderItem, KitchenTicket
from app.models.settings import BranchSettings
from app.schemas.restaurant import (
    RecipeCreate, RecipeUpdate, IngredientUsageReport, RawMaterialCreate,
    TableCreate, TableUpdate, SessionOpen, PlaceOrderRequest,
    CancelRequest, TicketStatusUpdate, SessionCheckoutRequest,
)
from app.schemas.product import ProductCreate, ProductListItem
from app.services.dining_service import DiningService
from app.services.product_service import ProductService
from app.services.recipe_service import RecipeService

router = APIRouter(prefix="/api/v1/restaurant", tags=["restaurant"])
public_router = APIRouter(prefix="/api/public/menu", tags=["restaurant-public"])
qs_router = APIRouter(prefix="/api/public/qs", tags=["restaurant-qs"])


def ok(data: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"data": data, "meta": {"version": settings.app_version, **(meta or {})}, "error": None}


# ── Recipes ───────────────────────────────────────────────────────────────────

@router.get("/recipes", response_model=None)
async def list_recipes(
    branch_id: uuid.UUID | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = RecipeService(db)
    items = await svc.list_recipes(current.company_id, branch_id or current.branch_id, include_inactive)
    return ok([item.model_dump() for item in items])


@router.post("/recipes", status_code=status.HTTP_201_CREATED)
async def create_recipe(
    payload: RecipeCreate,
    current: TokenData = Depends(require_permission("fb.recipe.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = RecipeService(db)
    recipe = await svc.create_recipe(current.company_id, payload)
    enriched = await svc._enrich_recipe(recipe, current.company_id)
    return ok(enriched.model_dump())


@router.get("/recipes/{recipe_id}")
async def get_recipe(
    recipe_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = RecipeService(db)
    recipe = await svc.get_recipe(recipe_id, current.company_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="ไม่พบสูตร")
    enriched = await svc._enrich_recipe(recipe, current.company_id)
    return ok(enriched.model_dump())


@router.patch("/recipes/{recipe_id}")
async def update_recipe(
    recipe_id: uuid.UUID,
    payload: RecipeUpdate,
    current: TokenData = Depends(require_permission("fb.recipe.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = RecipeService(db)
    recipe = await svc.get_recipe(recipe_id, current.company_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="ไม่พบสูตร")
    updated = await svc.update_recipe(recipe, current.company_id, payload)
    enriched = await svc._enrich_recipe(updated, current.company_id)
    return ok(enriched.model_dump())


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(
    recipe_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.recipe.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = RecipeService(db)
    recipe = await svc.get_recipe(recipe_id, current.company_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="ไม่พบสูตร")
    await svc.delete_recipe(recipe)
    return ok({"deleted": True})


# ── Raw Materials ─────────────────────────────────────────────────────────────

@router.post("/raw-materials", status_code=status.HTTP_201_CREATED)
async def create_raw_material(
    payload: RawMaterialCreate,
    current: TokenData = Depends(require_permission("fb.recipe.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    sku = payload.sku.strip()
    name = payload.name.strip()
    if not sku or not name:
        raise HTTPException(status_code=400, detail="กรุณาระบุ SKU และชื่อวัตถุดิบ")
    service = ProductService(db)
    product = await service.create_product(
        current.company_id,
        ProductCreate(
            sku=sku,
            name=name,
            description=f"Created from restaurant recipe setup ({payload.unit.strip() or 'unit'})",
            product_type="raw_material",
            cost_price=payload.cost_price,
            selling_price=0,
            vat_type="included",
            vat_rate=7,
            is_active=True,
            is_for_sale=False,
            is_for_purchase=True,
        ),
    )
    return ok(ProductListItem.model_validate(product).model_dump())


# ── Tables ───────────────────────────────────────────────────────────────────

@router.get("/tables")
async def list_tables(
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    svc = DiningService(db)
    return ok(await svc.list_tables(current.company_id, current.branch_id))


@router.post("/tables", status_code=status.HTTP_201_CREATED)
async def create_table(
    payload: TableCreate,
    current: TokenData = Depends(require_permission("fb.table.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    svc = DiningService(db)
    table = await svc.create_table(current.company_id, current.branch_id, payload.name, payload.capacity, payload.table_type, payload.sort_order)
    return ok({"id": str(table.id), "qr_token": str(table.qr_token), "name": table.name})


@router.get("/tables/{table_id}")
async def get_table(
    table_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    tables = await svc.list_tables(current.company_id, current.branch_id)
    found = next((t for t in tables if str(t.id) == str(table_id)), None)
    if not found:
        raise HTTPException(status_code=404, detail="ไม่พบโต๊ะ")
    return ok(found)


@router.patch("/tables/{table_id}")
async def update_table(
    table_id: uuid.UUID,
    payload: TableUpdate,
    current: TokenData = Depends(require_permission("fb.table.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    table = await db.get(DiningTable, table_id)
    if not table or table.company_id != current.company_id or table.branch_id != current.branch_id:
        raise HTTPException(status_code=404, detail="ไม่พบโต๊ะ")
    if payload.status == "available":
        active = await db.scalar(
            select(DiningSession.id).where(
                DiningSession.table_id == table_id,
                DiningSession.status.in_(["open", "bill_requested"]),
            ).limit(1)
        )
        if active:
            raise HTTPException(status_code=400, detail="โต๊ะนี้มี session ที่ยังเปิดอยู่")
    svc = DiningService(db)
    updated = await svc.update_table(table, **payload.model_dump(exclude_none=True))
    return ok({"id": str(updated.id), "status": updated.status, "name": updated.name})


@router.delete("/tables/{table_id}")
async def delete_table(
    table_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.table.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    table = await db.get(DiningTable, table_id)
    if not table or table.company_id != current.company_id or table.branch_id != current.branch_id:
        raise HTTPException(status_code=404, detail="ไม่พบโต๊ะ")
    # ตรวจว่าไม่มี open session
    from sqlalchemy import select as sa_select
    active = await db.scalar(
        sa_select(DiningSession.id).where(
            DiningSession.table_id == table_id,
            DiningSession.status.in_(["open", "bill_requested"]),
        ).limit(1)
    )
    if active:
        raise HTTPException(status_code=400, detail="มี session ที่ยังเปิดอยู่ ปิดโต๊ะก่อนลบ")
    table.is_active = False
    await db.commit()
    return ok({"deleted": True, "id": str(table_id)})


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions(
    status_filter: str | None = Query(default=None, alias="status"),
    date: str | None = Query(default=None, description="YYYY-MM-DD, default=today"),
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    from sqlalchemy import func
    from sqlalchemy.orm import selectinload

    target_date = date or datetime.now().strftime("%Y-%m-%d")

    q = (
        select(DiningSession)
        .options(selectinload(DiningSession.orders).selectinload(DiningOrder.items))
        .where(
            DiningSession.company_id == current.company_id,
            DiningSession.branch_id == current.branch_id,
            func.date(DiningSession.opened_at) == target_date,
        )
        .order_by(DiningSession.opened_at.desc())
    )
    if status_filter:
        q = q.where(DiningSession.status == status_filter)

    sessions = list((await db.scalars(q)).all())
    result = []
    for s in sessions:
        table = await db.get(DiningTable, s.table_id) if s.table_id else None
        all_items = [i for o in s.orders if o.status != "cancelled" for i in o.items]
        total = sum(float(i.unit_price) * i.qty for i in all_items)
        result.append({
            "id": str(s.id),
            "status": s.status,
            "source_type": "dine_in" if s.table_id else "quick_service",
            "table_name": table.name if table else None,
            "queue_number": s.queue_number,
            "customer_name": s.customer_name,
            "customer_phone": s.customer_phone,
            "opened_at": s.opened_at.isoformat(),
            "closed_at": s.closed_at.isoformat() if s.closed_at else None,
            "item_count": len(all_items),
            "pending_count": sum(i.qty for i in all_items if i.status == "pending"),
            "cooking_count": sum(i.qty for i in all_items if i.status == "cooking"),
            "ready_count": sum(i.qty for i in all_items if i.status == "done"),
            "served_count": sum(i.qty for i in all_items if i.status == "served"),
            "total_amount": round(total, 2),
            "sale_order_id": str(s.sale_order_id) if s.sale_order_id else None,
        })
    return ok(result)


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
async def open_session(
    payload: SessionOpen,
    current: TokenData = Depends(require_permission("fb.table.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    branch_settings = await db.scalar(
        select(BranchSettings).where(BranchSettings.branch_id == current.branch_id)
    )
    svc = DiningService(db)
    session = await svc.open_session(current.company_id, current.branch_id, payload, current.user_id, branch_settings)
    return ok({"id": str(session.id), "queue_number": session.queue_number})


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    session = await svc.get_session(session_id)
    if not session or session.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    return ok({"id": str(session.id), "status": session.status, "queue_number": session.queue_number})


@router.get("/sessions/{session_id}/detail")
async def get_session_detail(
    session_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    session = await svc.get_session(session_id)
    if not session or session.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    table = await db.get(DiningTable, session.table_id) if session.table_id else None
    active_orders = [order for order in session.orders if order.status != "cancelled"]
    active_items = [item for order in active_orders for item in order.items if item.status != "cancelled"]
    return ok({
        "id": str(session.id),
        "status": session.status,
        "queue_number": session.queue_number,
        "table_name": table.name if table else None,
        "customer_name": session.customer_name,
        "customer_phone": session.customer_phone,
        "opened_at": session.opened_at.isoformat() if session.opened_at else None,
        "closed_at": session.closed_at.isoformat() if session.closed_at else None,
        "pending_count": sum(item.qty for item in active_items if item.status == "pending"),
        "cooking_count": sum(item.qty for item in active_items if item.status == "cooking"),
        "ready_count": sum(item.qty for item in active_items if item.status == "done"),
        "served_count": sum(item.qty for item in active_items if item.status == "served"),
        "qr_pending_count": sum(item.qty for order in active_orders if order.source == "qr_self" for item in order.items if item.status == "pending"),
        "orders": [
            {
                "id": str(o.id),
                "order_number": o.order_number,
                "status": o.status,
                "source": o.source,
                "note": o.note,
                "created_at": o.created_at.isoformat() if o.created_at else None,
                "items": [
                    {
                        "id": str(i.id),
                        "product_name": i.product_name,
                        "qty": i.qty,
                        "unit_price": float(i.unit_price),
                        "special_request": i.special_request,
                        "status": i.status,
                    }
                    for i in o.items
                ],
            }
            for o in session.orders
        ],
    })


@router.post("/sessions/{session_id}/orders", status_code=status.HTTP_201_CREATED)
async def place_order(
    session_id: uuid.UUID,
    payload: PlaceOrderRequest,
    current: TokenData = Depends(require_permission("fb.order.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    session = await db.get(DiningSession, session_id)
    if not session or session.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    if session.status == "closed":
        raise HTTPException(status_code=400, detail="Session ปิดแล้ว")
    if session.status == "bill_requested":
        raise HTTPException(status_code=400, detail="ลูกค้าเรียกบิลแล้ว ไม่สามารถสั่งเพิ่มได้")
    branch_settings = await db.scalar(
        select(BranchSettings).where(BranchSettings.branch_id == session.branch_id)
    )
    order = await svc.place_order(current.company_id, session.branch_id, session, payload, "staff", branch_settings)
    return ok({"id": str(order.id), "order_number": order.order_number})


@router.post("/orders/{order_id}/cancel")
async def cancel_order(
    order_id: uuid.UUID,
    payload: CancelRequest,
    current: TokenData = Depends(require_permission("fb.order.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="กรุณาระบุเหตุผลการยกเลิก")
    order = await db.get(DiningOrder, order_id)
    if not order or order.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบออเดอร์")
    session = await db.get(DiningSession, order.session_id)
    if not session or session.status == "closed":
        raise HTTPException(status_code=400, detail="Session ปิดแล้ว")
    svc = DiningService(db)
    try:
        updated = await svc.cancel_order(order, payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(updated.id), "status": updated.status})


@router.post("/order-items/{item_id}/cancel")
async def cancel_order_item(
    item_id: uuid.UUID,
    payload: CancelRequest,
    current: TokenData = Depends(require_permission("fb.order.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="กรุณาระบุเหตุผลการยกเลิก")
    item = await db.get(DiningOrderItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="ไม่พบรายการ")
    order = await db.get(DiningOrder, item.order_id)
    if not order or order.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบออเดอร์")
    session = await db.get(DiningSession, order.session_id)
    if not session or session.status == "closed":
        raise HTTPException(status_code=400, detail="Session ปิดแล้ว")
    svc = DiningService(db)
    try:
        updated = await svc.cancel_order_item(item, payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(updated.id), "status": updated.status})


@router.patch("/order-items/{item_id}/status")
async def update_order_item_status(
    item_id: uuid.UUID,
    payload: TicketStatusUpdate,
    current: TokenData = Depends(require_permission("fb.kitchen.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    item = await db.get(DiningOrderItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="ไม่พบรายการ")
    order = await db.get(DiningOrder, item.order_id)
    if not order or order.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบออเดอร์")
    session = await db.get(DiningSession, order.session_id)
    if not session or session.status == "closed":
        raise HTTPException(status_code=400, detail="Session ปิดแล้ว")
    if payload.status not in ["pending", "cooking", "done", "served"]:
        raise HTTPException(status_code=400, detail="status ไม่ถูกต้อง")
    svc = DiningService(db)
    try:
        updated = await svc.update_order_item_status(item, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(updated.id), "status": updated.status})


@router.post("/sessions/{session_id}/bill")
async def request_bill(
    session_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.order.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    session = await db.get(DiningSession, session_id)
    if not session or session.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    updated = await svc.request_bill(session)
    return ok({"status": updated.status})


@router.post("/sessions/{session_id}/checkout")
async def checkout_session(
    session_id: uuid.UUID,
    payload: SessionCheckoutRequest,
    current: TokenData = Depends(require_permission("fb.order.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """รวมบิลโต๊ะ → สร้าง SaleOrder → ปิด session"""
    svc = DiningService(db)
    session = await db.get(DiningSession, session_id)
    if not session or session.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    if session.status == "closed":
        raise HTTPException(status_code=400, detail="Session ปิดแล้ว")
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    try:
        result = await svc.checkout_session(
            session, current.company_id, current.branch_id, current.user_id, payload
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok(result.model_dump())


@router.post("/sessions/{session_id}/close")
async def close_session(
    session_id: uuid.UUID,
    current: TokenData = Depends(require_permission("fb.table.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    session = await db.get(DiningSession, session_id)
    if not session or session.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    updated = await svc.close_session(session)
    return ok({"status": updated.status})


# ── Kitchen ───────────────────────────────────────────────────────────────────

@router.get("/kitchen")
async def list_kitchen_tickets(
    station: str | None = Query(default=None),
    current: TokenData = Depends(require_permission("fb.kitchen.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    svc = DiningService(db)
    tickets = await svc.list_kitchen_tickets(current.branch_id, station)
    return ok([{
        "id": str(t.id),
        "product_name": t.product_name,
        "qty": t.qty,
        "special_request": t.special_request,
        "station": t.station,
        "queue_number": t.queue_number,
        "table_name": t.table_name,
        "source_type": "dine_in" if t.table_name else "quick_service",
        "status": t.status,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "done_at": t.done_at.isoformat() if t.done_at else None,
    } for t in tickets])


@router.patch("/kitchen/{ticket_id}")
async def update_ticket(
    ticket_id: uuid.UUID,
    payload: TicketStatusUpdate,
    current: TokenData = Depends(require_permission("fb.kitchen.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ticket = await db.get(KitchenTicket, ticket_id)
    if not ticket or ticket.company_id != current.company_id:
        raise HTTPException(status_code=404, detail="ไม่พบ ticket")
    valid = ["pending", "cooking", "done", "served"]
    if payload.status not in valid:
        raise HTTPException(status_code=400, detail=f"status ต้องเป็น {valid}")
    svc = DiningService(db)
    try:
        updated = await svc.update_ticket_status(ticket, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(updated.id), "status": updated.status})


@router.get("/pickup-queue")
async def get_pickup_queue(
    current: TokenData = Depends(require_permission("fb.menu.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    svc = DiningService(db)
    queues = await svc.get_ready_pickup_queues(current.branch_id)
    return ok(queues)


# ── Ingredient Usage Report ───────────────────────────────────────────────────

# ── Quick Service QR ─────────────────────────────────────────────────────────

@router.post("/qs-qr/generate")
async def generate_qs_qr(
    current: TokenData = Depends(require_permission("fb.settings.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """สร้างหรือดึง QR token สำหรับ Quick Service ของสาขา"""
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")
    branch_settings = await db.scalar(
        select(BranchSettings).where(BranchSettings.branch_id == current.branch_id)
    )
    if not branch_settings:
        raise HTTPException(status_code=404, detail="ไม่พบ settings สาขา")
    if not branch_settings.fb_qs_qr_token:
        import uuid as _uuid
        branch_settings.fb_qs_qr_token = _uuid.uuid4()
        await db.commit()
        await db.refresh(branch_settings)
    return ok({"qs_qr_token": str(branch_settings.fb_qs_qr_token)})


# ── Line Notify Test ──────────────────────────────────────────────────────────

@router.post("/line-notify/test")
async def test_fb_line_notify(
    current: TokenData = Depends(require_permission("fb.settings.manage")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """ทดสอบส่ง Line Notify ด้วย token ที่ตั้งไว้ใน F&B settings"""
    if not current.branch_id:
        raise HTTPException(status_code=400, detail="Branch context required")

    branch_settings = await db.scalar(
        select(BranchSettings).where(BranchSettings.branch_id == current.branch_id)
    )
    if not branch_settings or not branch_settings.fb_line_notify_token:
        raise HTTPException(status_code=400, detail="ยังไม่ได้ตั้งค่า Line Notify Token สำหรับ F&B")

    from app.services.notification_service import NotificationService
    from app.models.branch import Branch as BranchModel
    branch = await db.get(BranchModel, current.branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="ไม่พบสาขา")

    svc = NotificationService(db)
    success = await svc.send_line_notify(
        token=branch_settings.fb_line_notify_token,
        message=f"\n✅ ทดสอบระบบ F&B แจ้งเตือน\nสาขา: {branch.name}\nLine Notify ทำงานปกติครับ 🎉",
        company_id=current.company_id,
        event_type="fb_test",
    )
    if not success:
        raise HTTPException(status_code=502, detail="ส่ง Line Notify ไม่สำเร็จ — ตรวจสอบ Token อีกครั้ง")
    return ok({"sent": True})


# ── Public QR Routes ─────────────────────────────────────────────────────────

@public_router.get("/{qr_token}")
async def public_get_menu(
    qr_token: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    menu = await svc.get_public_menu(qr_token)
    if not menu:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")
    return ok(menu.model_dump())


@public_router.post("/{qr_token}/orders", status_code=status.HTTP_201_CREATED)
async def public_place_order(
    qr_token: uuid.UUID,
    payload: PlaceOrderRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    table = await svc.get_table_by_token(qr_token)
    if not table:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")

    branch_settings = await db.scalar(
        select(BranchSettings).where(BranchSettings.branch_id == table.branch_id)
    )

    session = await svc.get_open_session_by_table(table.id)
    if session and session.status == "bill_requested":
        raise HTTPException(status_code=400, detail="มีการเรียกบิลแล้ว กรุณารอพนักงาน")
    if not session:
        session = await svc.open_session(
            table.company_id, table.branch_id,
            SessionOpen(table_id=table.id),
            opened_by=None,
            settings=branch_settings,
        )

    order = await svc.place_order(
        table.company_id, table.branch_id, session, payload, "qr_self", branch_settings,
    )
    return ok({
        "order_id": str(order.id),
        "order_number": order.order_number,
        "session_id": str(session.id),
        "queue_number": session.queue_number,
    })


@public_router.get("/{qr_token}/status")
async def public_order_status(
    qr_token: uuid.UUID,
    session_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    table = await svc.get_table_by_token(qr_token)
    if not table:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")
    session = await db.get(DiningSession, session_id)
    if not session or session.table_id != table.id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    result = await svc.get_public_order_status(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    return ok(result.model_dump())


@public_router.post("/{qr_token}/bill")
async def public_request_bill(
    qr_token: uuid.UUID,
    session_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = DiningService(db)
    table = await svc.get_table_by_token(qr_token)
    if not table:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")
    session = await db.get(DiningSession, session_id)
    if not session or session.table_id != table.id:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    updated = await svc.request_bill(session)
    return ok({"status": updated.status})


@router.get("/reports/ingredients")
async def ingredient_usage_report(
    branch_id: uuid.UUID = Query(...),
    date_from: date = Query(...),
    date_to: date = Query(...),
    current: TokenData = Depends(require_permission("fb.report.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    svc = RecipeService(db)
    report = await svc.get_ingredient_usage_report(
        current.company_id, branch_id, date_from, date_to
    )
    return ok(report.model_dump())


# ── Quick Service Public Routes ───────────────────────────────────────────────

async def _get_qs_settings(db: AsyncSession, qs_token: uuid.UUID) -> BranchSettings | None:
    return await db.scalar(
        select(BranchSettings).where(BranchSettings.fb_qs_qr_token == qs_token)
    )


@qs_router.get("/{qs_token}")
async def qs_get_menu(
    qs_token: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    settings = await _get_qs_settings(db, qs_token)
    if not settings:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")

    from app.models.branch import Branch as BranchModel
    from app.models.product import Product, Category as CategoryModel
    branch = await db.get(BranchModel, settings.branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="ไม่พบสาขา")

    products = list((await db.scalars(
        select(Product).where(
            Product.company_id == branch.company_id,
            Product.product_type == "menu_item",
            Product.is_active.is_(True),
            Product.is_for_sale.is_(True),
        ).order_by(Product.name)
    )).all())

    cats = list((await db.scalars(
        select(CategoryModel).where(
            CategoryModel.company_id == branch.company_id,
            CategoryModel.is_active.is_(True),
        )
    )).all())
    cat_map = {c.id: c.name for c in cats}
    prefix = settings.fb_queue_prefix or ""

    return ok({
        "branch_name": branch.name,
        "fb_service_mode": settings.fb_service_mode,
        "queue_prefix": prefix,
        "categories": [{"id": str(c.id), "name": c.name} for c in cats],
        "products": [
            {
                "id": str(p.id),
                "name": p.name,
                "description": p.description,
                "selling_price": float(p.selling_price),
                "category_id": str(p.category_id) if p.category_id else None,
                "category_name": cat_map.get(p.category_id) if p.category_id else None,
                "image_url": p.image_url,
                "is_available": True,
            }
            for p in products
        ],
    })


@qs_router.post("/{qs_token}/orders", status_code=201)
async def qs_place_order(
    qs_token: uuid.UUID,
    payload: PlaceOrderRequest,
    customer_name: str | None = Query(default=None),
    customer_phone: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    settings = await _get_qs_settings(db, qs_token)
    if not settings:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")

    from app.models.branch import Branch as BranchModel
    branch = await db.get(BranchModel, settings.branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="ไม่พบสาขา")

    svc = DiningService(db)
    # สร้าง session ใหม่เสมอสำหรับ Quick Service (ไม่แชร์กัน)
    session = await svc.open_session(
        company_id=branch.company_id,
        branch_id=settings.branch_id,
        payload=SessionOpen(table_id=None, guest_count=1, customer_name=customer_name, customer_phone=customer_phone),
        opened_by=None,
        settings=settings,
    )

    order = await svc.place_order(
        branch.company_id, settings.branch_id, session, payload, "qr_self", settings,
    )

    prefix = settings.fb_queue_prefix or ""
    return ok({
        "order_id": str(order.id),
        "order_number": order.order_number,
        "session_id": str(session.id),
        "queue_number": session.queue_number,
        "queue_display": f"{prefix}{str(session.queue_number).zfill(3)}" if session.queue_number else None,
    })


@qs_router.get("/{qs_token}/status")
async def qs_order_status(
    qs_token: uuid.UUID,
    session_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    settings = await _get_qs_settings(db, qs_token)
    if not settings:
        raise HTTPException(status_code=404, detail="ไม่พบ QR นี้")
    session = await db.get(DiningSession, session_id)
    if not session or session.branch_id != settings.branch_id or session.table_id is not None:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    svc = DiningService(db)
    result = await svc.get_public_order_status(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="ไม่พบ session")
    return ok(result.model_dump())
