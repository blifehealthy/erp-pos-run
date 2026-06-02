from __future__ import annotations

from decimal import Decimal
import uuid

from pydantic import ConfigDict

from app.schemas import BaseSchema


# ── Recipe Ingredient ────────────────────────────────────────────────────────

class RecipeIngredientBase(BaseSchema):
    ingredient_id: uuid.UUID
    quantity: Decimal
    unit: str
    sort_order: int = 0
    notes: str | None = None


class RecipeIngredientCreate(RecipeIngredientBase):
    pass


class RecipeIngredientRead(RecipeIngredientBase):
    id: uuid.UUID
    recipe_id: uuid.UUID
    ingredient_name: str = ""
    ingredient_sku: str = ""
    latest_unit_cost: Decimal = Decimal("0")
    cost_per_recipe: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)


# ── Recipe ───────────────────────────────────────────────────────────────────

class RecipeCreate(BaseSchema):
    product_id: uuid.UUID
    branch_id: uuid.UUID | None = None
    name: str
    yield_qty: Decimal = Decimal("1")
    yield_unit: str = "แก้ว"
    notes: str | None = None
    ingredients: list[RecipeIngredientCreate] = []


class RecipeUpdate(BaseSchema):
    name: str | None = None
    yield_qty: Decimal | None = None
    yield_unit: str | None = None
    notes: str | None = None
    is_active: bool | None = None
    ingredients: list[RecipeIngredientCreate] | None = None


class RecipeRead(BaseSchema):
    id: uuid.UUID
    company_id: uuid.UUID
    branch_id: uuid.UUID | None
    product_id: uuid.UUID
    product_name: str = ""
    product_sku: str = ""
    name: str
    yield_qty: Decimal
    yield_unit: str
    notes: str | None
    is_active: bool
    ingredients: list[RecipeIngredientRead] = []
    total_cost: Decimal = Decimal("0")
    cost_per_yield: Decimal = Decimal("0")
    selling_price: Decimal = Decimal("0")
    gross_margin_pct: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)


class RecipeListItem(BaseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str = ""
    name: str
    yield_unit: str
    is_active: bool
    total_cost: Decimal = Decimal("0")
    selling_price: Decimal = Decimal("0")
    gross_margin_pct: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)


# ── Raw Material ──────────────────────────────────────────────────────────────

class RawMaterialCreate(BaseSchema):
    sku: str
    name: str
    cost_price: Decimal = Decimal("0")
    unit: str = "g"


# ── Dining Table ─────────────────────────────────────────────────────────────

class TableCreate(BaseSchema):
    name: str
    capacity: int = 4
    table_type: str = "dine_in"
    sort_order: int = 0


class TableUpdate(BaseSchema):
    name: str | None = None
    capacity: int | None = None
    status: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class TableRead(BaseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    name: str
    capacity: int
    qr_token: uuid.UUID
    table_type: str
    status: str
    sort_order: int
    is_active: bool
    active_session_id: uuid.UUID | None = None
    queue_number: int | None = None
    pending_count: int = 0
    cooking_count: int = 0
    ready_count: int = 0
    served_count: int = 0
    qr_pending_count: int = 0

    model_config = ConfigDict(from_attributes=True)


# ── Dining Session ────────────────────────────────────────────────────────────

class SessionOpen(BaseSchema):
    table_id: uuid.UUID | None = None
    guest_count: int = 1
    customer_name: str | None = None
    customer_phone: str | None = None


class SessionRead(BaseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    table_id: uuid.UUID | None
    table_name: str | None = None
    queue_number: int | None
    status: str
    guest_count: int
    customer_name: str | None
    customer_phone: str | None
    opened_at: str
    orders: list["DiningOrderRead"] = []

    model_config = ConfigDict(from_attributes=True)


# ── Dining Order ──────────────────────────────────────────────────────────────

class OrderItemCreate(BaseSchema):
    product_id: uuid.UUID
    qty: int = 1
    special_request: str | None = None


class PlaceOrderRequest(BaseSchema):
    items: list[OrderItemCreate]
    note: str | None = None


class CancelRequest(BaseSchema):
    reason: str


class DiningOrderItemRead(BaseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    qty: int
    unit_price: Decimal
    special_request: str | None
    status: str

    model_config = ConfigDict(from_attributes=True)


class DiningOrderRead(BaseSchema):
    id: uuid.UUID
    session_id: uuid.UUID
    order_number: str
    source: str
    status: str
    items: list[DiningOrderItemRead] = []

    model_config = ConfigDict(from_attributes=True)


# ── Kitchen Ticket ────────────────────────────────────────────────────────────

class KitchenTicketRead(BaseSchema):
    id: uuid.UUID
    session_id: uuid.UUID
    order_item_id: uuid.UUID
    product_name: str
    qty: int
    special_request: str | None
    station: str | None
    queue_number: int | None
    table_name: str | None
    status: str
    created_at: str
    done_at: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TicketStatusUpdate(BaseSchema):
    status: str


# ── Session Checkout ──────────────────────────────────────────────────────────

class SessionCheckoutRequest(BaseSchema):
    shift_id: uuid.UUID | None = None      # None = auto-detect จาก open shift
    location_id: uuid.UUID | None = None   # None = auto-detect จาก shift
    payment_method: str
    paid_amount: Decimal
    payments: list[dict] = []          # [{payment_method, amount, reference_no}]
    discount_amount: Decimal = Decimal("0")
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_tax_id: str | None = None
    customer_id: uuid.UUID | None = None
    note: str | None = None


class SessionCheckoutResult(BaseSchema):
    sale_order_id: uuid.UUID
    order_number: str
    total_amount: Decimal
    paid_amount: Decimal
    change_amount: Decimal
    session_id: uuid.UUID
    table_name: str | None = None
    queue_number: int | None = None
    source_type: str = "dine_in"
    customer_name: str | None = None
    customer_phone: str | None = None
    payment_method: str
    note: str | None = None


# ── Public Menu (QR) ──────────────────────────────────────────────────────────

class PublicMenuProduct(BaseSchema):
    id: uuid.UUID
    name: str
    description: str | None
    selling_price: Decimal
    category_id: uuid.UUID | None
    category_name: str | None = None
    image_url: str | None
    is_available: bool


class PublicMenuResponse(BaseSchema):
    session_id: uuid.UUID | None
    queue_number: int | None
    table_name: str | None
    branch_name: str
    fb_service_mode: str
    categories: list[dict]
    products: list[PublicMenuProduct]
    session_status: str | None = None


class PublicOrderStatus(BaseSchema):
    session_id: uuid.UUID
    queue_number: int | None
    session_status: str
    items: list[DiningOrderItemRead]


# ── Ingredient Usage Report ───────────────────────────────────────────────────

class IngredientUsageItem(BaseSchema):
    ingredient_id: uuid.UUID
    ingredient_name: str
    ingredient_sku: str
    theoretical_qty: Decimal
    unit: str
    latest_unit_cost: Decimal
    total_cost: Decimal


class IngredientUsageReport(BaseSchema):
    branch_id: uuid.UUID
    date_from: str
    date_to: str
    items: list[IngredientUsageItem]
    grand_total_cost: Decimal


SessionRead.model_rebuild()
