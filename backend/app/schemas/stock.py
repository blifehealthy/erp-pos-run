from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import uuid

from pydantic import ConfigDict, Field

from app.schemas import BaseSchema


class StockLocationBase(BaseSchema):
    branch_id: uuid.UUID
    code: str
    name: str
    description: str | None = None
    is_active: bool = True


class StockLocationCreate(StockLocationBase):
    pass


class StockLocationUpdate(BaseSchema):
    branch_id: uuid.UUID | None = None
    code: str | None = None
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None


class StockLocationRead(StockLocationBase):
    id: uuid.UUID
    company_id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)


class StockBalanceRead(BaseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID | None
    location_id: uuid.UUID
    branch_id: uuid.UUID
    qty_on_hand: Decimal
    qty_reserved: Decimal
    qty_available: Decimal
    cost_per_unit: Decimal
    last_movement_at: datetime | None
    product_name: str
    product_sku: str
    unit_code: str | None = None
    variant_name: str | None = None
    location_name: str | None = None
    min_stock_qty: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)


class StockMovementRead(BaseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID | None
    location_id: uuid.UUID
    branch_id: uuid.UUID
    movement_type: str
    qty: Decimal
    qty_before: Decimal
    qty_after: Decimal
    cost_per_unit: Decimal
    reference_type: str | None = None
    reference_id: str | None = None
    note: str | None = None
    user_id: uuid.UUID
    created_at: datetime
    product_name: str
    product_sku: str
    variant_name: str | None = None
    user_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AdjustmentRequest(BaseSchema):
    location_id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    qty: Decimal
    note: str | None = None
    cost_per_unit: Decimal | None = None


class ReceiveItem(BaseSchema):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    qty: Decimal
    cost_per_unit: Decimal | None = None


class ReceiveStockRequest(BaseSchema):
    location_id: uuid.UUID
    items: list[ReceiveItem] = Field(default_factory=list)
    note: str | None = None
    reference_type: str | None = None
    reference_id: str | None = None


class TransferItem(BaseSchema):
    product_id: uuid.UUID
    variant_id: uuid.UUID | None = None
    qty: Decimal


class TransferRequest(BaseSchema):
    from_location_id: uuid.UUID
    to_location_id: uuid.UUID
    items: list[TransferItem] = Field(default_factory=list)
    note: str | None = None


class StockSummaryResponse(BaseSchema):
    total_skus: int
    total_value: Decimal
    low_stock_count: int
    zero_stock_count: int

    model_config = ConfigDict(from_attributes=True)
