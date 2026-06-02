from __future__ import annotations

from typing import Any
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import TokenData, get_current_user, require_permission
from app.models.role import Permission
from app.schemas.role import PermissionRead
from app.schemas.product import BranchProductReplacementRuleCreate
from app.schemas.user_mgmt import (
    AcceptInvitationRequest,
    AssignBranchRequest,
    BranchCreateFull,
    BranchSettingsRead,
    BranchSettingsUpdate,
    BranchUpdateFull,
    ChangePasswordRequest,
    InviteUserRequest,
    InviteUserResponse,
    RemoveBranchRequest,
    RoleCreateFull,
    RoleUpdateFull,
    UserCreateFull,
    UserUpdateFull,
)
from app.services.admin_service import AdminService
from app.utils.health_check import get_system_health

router = APIRouter(prefix="/api/v1/system", tags=["system"])


def ok(data: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"data": data, "meta": {"version": settings.app_version, **(meta or {})}, "error": None}


async def _require_branch_access(
    service: AdminService,
    current: TokenData,
    branch_id: uuid.UUID,
) -> None:
    if "*" in current.permissions:
        return
    if await service.can_access_branch(current.company_id, current.user_id, branch_id):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")


@router.get("/permissions")
async def get_permissions(
    _: TokenData = Depends(require_permission("system.role.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    rows = await db.scalars(select(Permission).order_by(Permission.module, Permission.code))
    data = [PermissionRead.model_validate(permission).model_dump() for permission in rows.all()]
    return ok(data)


@router.get("/me/branches")
async def my_branches(
    current: TokenData = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    detail = await service.get_user_detail(current.user_id, current.company_id)
    data = [
        {
            "branch_id": item.branch_id,
            "branch_name": item.branch_name,
            "role_name": item.role_name,
            "is_default": item.is_default,
        }
        for item in detail.branches
    ]
    return ok(data)


@router.get("/users")
async def get_users(
    current: TokenData = Depends(require_permission("system.user.view")),
    db: AsyncSession = Depends(get_db),
    branch_id: uuid.UUID | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    service = AdminService(db)
    effective_branch_id = branch_id
    if "*" not in current.permissions:
        if branch_id and branch_id != current.branch_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Branch access denied")
        effective_branch_id = current.branch_id

    users, total = await service.list_users(
        company_id=current.company_id,
        branch_id=effective_branch_id,
        is_active=is_active,
        search=search,
        page=page,
        limit=limit,
    )
    data = [item.model_dump() for item in await service.serialize_users(users)]
    return ok(data, meta={"total": total, "page": page, "limit": limit})


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateFull,
    current: TokenData = Depends(require_permission("system.user.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    user = await service.create_user(current.company_id, current.user_id, payload)
    detail = await service.get_user_detail(user.id, current.company_id)
    return ok(detail.model_dump())


@router.get("/users/{user_id}")
async def get_user_detail(
    user_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.user.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    detail = await service.get_user_detail(user_id, current.company_id)
    if "*" not in current.permissions and current.branch_id not in {item.branch_id for item in detail.branches}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return ok(detail.model_dump())


@router.patch("/users/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateFull,
    current: TokenData = Depends(require_permission("system.user.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    if "*" not in current.permissions:
        detail = await service.get_user_detail(user_id, current.company_id)
        if current.branch_id not in {item.branch_id for item in detail.branches}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await service.update_user(user_id, current.company_id, payload)
    detail = await service.get_user_detail(user_id, current.company_id)
    return ok(detail.model_dump())


@router.post("/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.user.delete")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await service.deactivate_user(user_id, current.company_id, current.user_id)
    detail = await service.get_user_detail(user_id, current.company_id)
    return ok(detail.model_dump())


@router.post("/users/{user_id}/change-password")
async def change_user_password(
    user_id: uuid.UUID,
    payload: ChangePasswordRequest,
    current: TokenData = Depends(require_permission("system.user.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await service.change_user_password(user_id, current.company_id, current.user_id, payload)
    return ok({"message": "Password changed"})


@router.post("/users/{user_id}/branches")
async def assign_user_branch(
    user_id: uuid.UUID,
    payload: AssignBranchRequest,
    current: TokenData = Depends(require_permission("system.user.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await service.assign_branch(user_id, current.company_id, payload)
    detail = await service.get_user_detail(user_id, current.company_id)
    return ok(detail.model_dump())


@router.delete("/users/{user_id}/branches/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_branch(
    user_id: uuid.UUID,
    branch_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.user.edit")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    service = AdminService(db)
    await service.remove_branch(user_id, current.company_id, RemoveBranchRequest(branch_id=branch_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/roles")
async def get_roles(
    current: TokenData = Depends(require_permission("system.role.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    data = [role.model_dump() for role in await service.list_roles(current.company_id)]
    return ok(data)


@router.post("/roles", status_code=status.HTTP_201_CREATED)
async def create_role(
    payload: RoleCreateFull,
    current: TokenData = Depends(require_permission("system.role.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    role = await service.create_role(current.company_id, payload)
    detail = await service.get_role_detail(role.id, current.company_id)
    return ok(detail.model_dump())


@router.patch("/roles/{role_id}")
async def update_role(
    role_id: uuid.UUID,
    payload: RoleUpdateFull,
    current: TokenData = Depends(require_permission("system.role.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    role = await service.update_role(role_id, current.company_id, payload)
    detail = await service.get_role_detail(role.id, current.company_id)
    return ok(detail.model_dump())


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.role.delete")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    service = AdminService(db)
    await service.delete_role(role_id, current.company_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/branches")
async def get_branches(
    current: TokenData = Depends(require_permission("system.branch.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    data = [branch.model_dump() for branch in await service.list_branches(current.company_id, current)]
    return ok(data)


@router.post("/branches", status_code=status.HTTP_201_CREATED)
async def create_branch(
    payload: BranchCreateFull,
    current: TokenData = Depends(require_permission("system.branch.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    branch = await service.create_branch(current.company_id, payload)
    detail = await service.get_branch_detail(branch.id, current.company_id)
    return ok(detail.model_dump())


@router.get("/branches/{branch_id}")
async def get_branch_detail(
    branch_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.branch.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    detail = await service.get_branch_detail(branch_id, current.company_id)
    return ok(detail.model_dump())


@router.patch("/branches/{branch_id}")
async def update_branch(
    branch_id: uuid.UUID,
    payload: BranchUpdateFull,
    current: TokenData = Depends(require_permission("system.branch.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    branch = await service.update_branch(branch_id, current.company_id, payload)
    detail = await service.get_branch_detail(branch.id, current.company_id)
    return ok(detail.model_dump())


@router.get("/branches/{branch_id}/settings")
async def get_branch_settings(
    branch_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.branch.view")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    settings_row = await service.get_branch_settings(branch_id, current.company_id)
    settings_data: BranchSettingsRead = service.serialize_branch_settings(settings_row)
    return ok(settings_data.model_dump())


@router.patch("/branches/{branch_id}/settings")
async def update_branch_settings(
    branch_id: uuid.UUID,
    payload: BranchSettingsUpdate,
    current: TokenData = Depends(require_permission("system.branch.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    settings_row = await service.update_branch_settings(branch_id, current.company_id, payload)
    settings_data: BranchSettingsRead = service.serialize_branch_settings(settings_row)
    return ok(settings_data.model_dump())


@router.get("/branches/{branch_id}/replacement-rules")
async def get_branch_replacement_rules(
    branch_id: uuid.UUID,
    current: TokenData = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    data = [item.model_dump() for item in await service.list_branch_replacement_rules(branch_id, current.company_id)]
    return ok(data)


@router.post("/branches/{branch_id}/replacement-rules", status_code=status.HTTP_201_CREATED)
async def upsert_branch_replacement_rule(
    branch_id: uuid.UUID,
    payload: BranchProductReplacementRuleCreate,
    current: TokenData = Depends(require_permission("system.branch.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    row = await service.upsert_branch_replacement_rule(branch_id, current.company_id, current.user_id, payload)
    detail = await service.list_branch_replacement_rules(branch_id, current.company_id)
    current_row = next(item for item in detail if item.id == row.id)
    return ok(current_row.model_dump())


@router.delete("/branches/{branch_id}/replacement-rules/{source_product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch_replacement_rule(
    branch_id: uuid.UUID,
    source_product_id: uuid.UUID,
    current: TokenData = Depends(require_permission("system.branch.edit")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    service = AdminService(db)
    await _require_branch_access(service, current, branch_id)
    await service.delete_branch_replacement_rule(branch_id, current.company_id, current.user_id, source_product_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InviteUserRequest,
    current: TokenData = Depends(require_permission("system.user.create")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    service = AdminService(db)
    invitation, plain_otp = await service.create_invitation(current.company_id, current.user_id, payload)
    response = InviteUserResponse(
        invitation_id=invitation.id,
        otp_code=plain_otp,
        expires_at=invitation.expires_at,
        message="Invitation created successfully",
    )
    return ok(response.model_dump())


@router.post("/invitations/accept")
async def accept_invitation(
    payload: AcceptInvitationRequest,
    db: AsyncSession = Depends(get_db),
    x_company_id: str | None = Header(default=None, alias="X-Company-ID"),
) -> dict[str, Any]:
    if not x_company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company ID is required")
    company_id = uuid.UUID(x_company_id)
    service = AdminService(db)
    await service.accept_invitation(payload.otp_code, company_id, payload)
    return ok({"message": "บัญชีสร้างแล้ว กรุณาเข้าสู่ระบบ"})


@router.get("/health-detail")
async def health_detail(
    current: TokenData = Depends(require_permission("system.company.edit")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    data = await get_system_health(db, current.company_id)
    return ok(data)
