from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.utils.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


@dataclass
class TokenData:
    user_id: uuid.UUID
    company_id: uuid.UUID
    branch_id: uuid.UUID | None
    permissions: list[str]


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> TokenData:
    del db
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )
    return TokenData(
        user_id=uuid.UUID(payload["sub"]),
        company_id=uuid.UUID(payload["company_id"]),
        branch_id=uuid.UUID(payload["branch_id"]) if payload.get("branch_id") else None,
        permissions=payload.get("permissions", []),
    )


def require_permission(code: str) -> Callable:
    async def checker(current: TokenData = Depends(get_current_user)) -> TokenData:
        if "*" in current.permissions or code in current.permissions:
            return current
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission required: {code}",
        )

    return checker


async def get_current_user_db(
    current: TokenData = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, current.user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user
