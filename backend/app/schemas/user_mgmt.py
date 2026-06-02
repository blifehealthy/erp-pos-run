from __future__ import annotations

from datetime import datetime
from typing import Any
import uuid

from pydantic import ConfigDict

from app.schemas import BaseSchema
from app.schemas.role import PermissionRead


class UserBranchDetail(BaseSchema):
    branch_id: uuid.UUID
    branch_name: str
    branch_code: str
    role_id: uuid.UUID
    role_name: str
    is_default: bool

    model_config = ConfigDict(from_attributes=True)


class UserCreateFull(BaseSchema):
    username: str
    email: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    password: str
    branch_id: uuid.UUID
    role_id: uuid.UUID


class UserUpdateFull(BaseSchema):
    email: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    is_active: bool | None = None


class UserDetailRead(BaseSchema):
    id: uuid.UUID
    company_id: uuid.UUID
    username: str
    email: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    is_active: bool
    is_superuser: bool
    last_login_at: datetime | None = None
    created_at: datetime
    branches: list[UserBranchDetail]

    model_config = ConfigDict(from_attributes=True)


class AssignBranchRequest(BaseSchema):
    branch_id: uuid.UUID
    role_id: uuid.UUID
    is_default: bool = False


class RemoveBranchRequest(BaseSchema):
    branch_id: uuid.UUID


class ChangePasswordRequest(BaseSchema):
    new_password: str


class RoleCreateFull(BaseSchema):
    name: str
    description: str | None = None
    permission_ids: list[uuid.UUID]


class RoleUpdateFull(BaseSchema):
    name: str | None = None
    description: str | None = None
    permission_ids: list[uuid.UUID] | None = None


class RoleDetailRead(BaseSchema):
    id: uuid.UUID
    company_id: uuid.UUID
    name: str
    description: str | None = None
    is_system: bool
    created_at: datetime
    permissions: list[PermissionRead]
    user_count: int

    model_config = ConfigDict(from_attributes=True)


class BranchSettingsRead(BaseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    pos_receipt_header: str | None = None
    pos_receipt_footer: str | None = None
    pos_require_customer: bool
    pos_allow_discount: bool
    pos_max_discount_pct: float
    promptpay_target: str | None = None
    promptpay_name: str | None = None
    working_hours: dict[str, Any] | None = None
    public_storefront_enabled: bool
    allow_negative_stock: bool
    low_stock_alert_enabled: bool
    receipt_show_tax_id: bool
    receipt_show_logo: bool
    receipt_copies: int
    notify_low_stock_email: str | None = None
    # F&B
    fb_enabled: bool = False
    fb_service_mode: str = "quick_service"
    fb_table_qr_enabled: bool = False
    fb_bill_at_table: bool = False
    fb_queue_enabled: bool = True
    fb_queue_reset: str = "daily"
    fb_queue_prefix: str = ""
    fb_pickup_display_enabled: bool = True
    fb_line_notify_token: str | None = None
    fb_line_mode: str = "group"
    fb_kitchen_stations: list[str] | None = None
    fb_setup_completed: bool = False
    fb_qs_qr_token: str | None = None

    model_config = ConfigDict(from_attributes=True)


class BranchSettingsUpdate(BaseSchema):
    pos_receipt_header: str | None = None
    pos_receipt_footer: str | None = None
    pos_require_customer: bool | None = None
    pos_allow_discount: bool | None = None
    pos_max_discount_pct: float | None = None
    pos_default_price_list_id: uuid.UUID | None = None
    promptpay_target: str | None = None
    promptpay_name: str | None = None
    working_hours: dict[str, Any] | None = None
    public_storefront_enabled: bool | None = None
    allow_negative_stock: bool | None = None
    low_stock_alert_enabled: bool | None = None
    receipt_show_tax_id: bool | None = None
    receipt_show_logo: bool | None = None
    receipt_copies: int | None = None
    notify_low_stock_email: str | None = None
    # F&B
    fb_enabled: bool | None = None
    fb_service_mode: str | None = None
    fb_table_qr_enabled: bool | None = None
    fb_bill_at_table: bool | None = None
    fb_queue_enabled: bool | None = None
    fb_queue_reset: str | None = None
    fb_queue_prefix: str | None = None
    fb_pickup_display_enabled: bool | None = None
    fb_line_notify_token: str | None = None
    fb_line_mode: str | None = None
    fb_kitchen_stations: list[str] | None = None
    fb_setup_completed: bool | None = None
    fb_qs_qr_token: str | None = None


class BranchCreateFull(BaseSchema):
    code: str
    name: str
    name_en: str | None = None
    address: str | None = None
    landmark: str | None = None
    phone: str | None = None
    email: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    google_maps_url: str | None = None
    is_warehouse: bool = False
    sort_order: int = 0


class BranchUpdateFull(BaseSchema):
    name: str | None = None
    name_en: str | None = None
    address: str | None = None
    landmark: str | None = None
    phone: str | None = None
    email: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    google_maps_url: str | None = None
    is_active: bool | None = None
    is_warehouse: bool | None = None
    sort_order: int | None = None


class BranchDetailRead(BaseSchema):
    id: uuid.UUID
    company_id: uuid.UUID
    code: str
    name: str
    name_en: str | None = None
    address: str | None = None
    landmark: str | None = None
    phone: str | None = None
    email: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    google_maps_url: str | None = None
    is_warehouse: bool
    is_active: bool
    sort_order: int
    created_at: datetime
    user_count: int
    settings: BranchSettingsRead | None = None

    model_config = ConfigDict(from_attributes=True)


class InviteUserRequest(BaseSchema):
    email: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    branch_id: uuid.UUID
    role_id: uuid.UUID


class InviteUserResponse(BaseSchema):
    invitation_id: uuid.UUID
    otp_code: str
    expires_at: datetime
    message: str


class AcceptInvitationRequest(BaseSchema):
    otp_code: str
    username: str
    password: str
