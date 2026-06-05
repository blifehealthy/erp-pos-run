from __future__ import annotations

from datetime import date
from typing import Any
import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import TokenData, require_permission
from app.models.audit import AuditLog
from app.schemas.stock import (
    AdjustmentRequest,
    ReceiveStockRequest,
    StockBalanceRead,
    StockLocationCreate,
    StockLocationRead,
    StockMovementRead,
    StockSummaryResponse,
    TransferRequest,
)
from app.services.stock_service import StockService

router = APIRouter(prefix="/api/v1/stock", tags=["stock"])


def ok(data: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"data": data, "meta": {"version": settings.app_version, **(meta or {})}, "error": None}


@router.get("/locations")
async def list_locations(
    branch_id: uuid.UUID | None = Query(default=None),
    current: TokenData = Depends(require_permission("inventory.stock.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    locations = await service.list_locations(current.company_id, branch_id)
    return ok([StockLocationRead.model_validate(item).model_dump() for item in locations])


@router.post("/locations", status_code=status.HTTP_201_CREATED)
async def create_location(
    payload: StockLocationCreate,
    current: TokenData = Depends(require_permission("inventory.stock.adjust")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    location = await service.create_location(current.company_id, payload)
    return ok(StockLocationRead.model_validate(location).model_dump())


@router.get("/balances")
async def list_balances(
    branch_id: uuid.UUID | None = Query(default=None),
    location_id: uuid.UUID | None = Query(default=None),
    product_id: uuid.UUID | None = Query(default=None),
    low_stock_only: bool = Query(default=False),
    current: TokenData = Depends(require_permission("inventory.stock.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    balances = await service.list_balances(
        company_id=current.company_id,
        branch_id=branch_id,
        location_id=location_id,
        product_id=product_id,
        low_stock_only=low_stock_only,
    )
    return ok([StockBalanceRead.model_validate(item).model_dump() for item in balances])


@router.get("/summary")
async def get_summary(
    branch_id: uuid.UUID | None = Query(default=None),
    current: TokenData = Depends(require_permission("inventory.stock.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    summary = await service.get_stock_summary(current.company_id, branch_id)
    return ok(StockSummaryResponse.model_validate(summary).model_dump())


@router.get("/movements")
async def list_movements(
    product_id: uuid.UUID | None = Query(default=None),
    branch_id: uuid.UUID | None = Query(default=None),
    movement_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    current: TokenData = Depends(require_permission("inventory.stock.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    movements, total = await service.list_movements(
        company_id=current.company_id,
        product_id=product_id,
        branch_id=branch_id,
        movement_type=movement_type,
        page=page,
        limit=limit,
        date_from=date_from,
        date_to=date_to,
    )
    return ok(
        [StockMovementRead.model_validate(item).model_dump() for item in movements],
        meta={"total": total, "page": page, "limit": limit},
    )


@router.post("/adjust", status_code=status.HTTP_201_CREATED)
async def adjust_stock(
    payload: AdjustmentRequest,
    current: TokenData = Depends(require_permission("inventory.stock.adjust")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    movement = await service.adjust(current.company_id, current.user_id, payload)
    db.add(
        AuditLog(
            company_id=current.company_id,
            branch_id=movement.branch_id,
            user_id=current.user_id,
            action="stock.adjust",
            resource="StockMovement",
            resource_id=str(movement.id),
            new_value={"product_id": str(payload.product_id), "qty": str(payload.qty)},
        )
    )
    await db.commit()
    movement = (await service.list_movements(current.company_id, product_id=movement.product_id, page=1, limit=1))[0][0]
    return ok(StockMovementRead.model_validate(movement).model_dump())


@router.post("/receive", status_code=status.HTTP_201_CREATED)
async def receive_stock(
    payload: ReceiveStockRequest,
    current: TokenData = Depends(require_permission("inventory.stock.adjust")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    movements = await service.receive(current.company_id, current.user_id, payload)
    for movement in movements:
        db.add(
            AuditLog(
                company_id=current.company_id,
                branch_id=movement.branch_id,
                user_id=current.user_id,
                action="stock.receive",
                resource="StockMovement",
                resource_id=str(movement.id),
            )
        )
    await db.commit()
    detailed, _ = await service.list_movements(
        company_id=current.company_id,
        product_id=movements[0].product_id if len(movements) == 1 else None,
        page=1,
        limit=max(len(movements), 1),
    )
    detailed_map = {item.id: item for item in detailed}
    data = [StockMovementRead.model_validate(detailed_map.get(item.id, item)).model_dump() for item in movements]
    return ok(data)


@router.post("/transfer", status_code=status.HTTP_201_CREATED)
async def transfer_stock(
    payload: TransferRequest,
    current: TokenData = Depends(require_permission("inventory.stock.adjust")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    movements = await service.transfer(current.company_id, current.user_id, payload)
    for movement in movements:
        db.add(
            AuditLog(
                company_id=current.company_id,
                branch_id=movement.branch_id,
                user_id=current.user_id,
                action="stock.transfer",
                resource="StockMovement",
                resource_id=str(movement.id),
            )
        )
    await db.commit()
    detailed, _ = await service.list_movements(
        company_id=current.company_id,
        product_id=movements[0].product_id if len(movements) == 2 else None,
        page=1,
        limit=max(len(movements), 1),
    )
    detailed_map = {item.id: item for item in detailed}
    data = [StockMovementRead.model_validate(detailed_map.get(item.id, item)).model_dump() for item in movements]
    return ok(data)


@router.get("/products/{product_id}")
async def get_product_stock(
    product_id: uuid.UUID,
    current: TokenData = Depends(require_permission("inventory.stock.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = StockService(db)
    balances = await service.get_product_stock(product_id, current.company_id)
    return ok([StockBalanceRead.model_validate(item).model_dump() for item in balances])
