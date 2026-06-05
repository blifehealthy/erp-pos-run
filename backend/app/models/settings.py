from __future__ import annotations

from datetime import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class BranchSettings(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "branch_settings"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("branches.id"),
        nullable=False,
        unique=True,
    )
    pos_receipt_header: Mapped[str | None] = mapped_column(Text, nullable=True)
    pos_receipt_footer: Mapped[str | None] = mapped_column(Text, nullable=True)
    pos_require_customer: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    pos_allow_discount: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    pos_max_discount_pct: Mapped[float] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        server_default=text("100"),
    )
    pos_default_price_list_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    promptpay_target: Mapped[str | None] = mapped_column(String(20), nullable=True)
    promptpay_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    working_hours: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    public_storefront_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    allow_negative_stock: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    low_stock_alert_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    receipt_show_tax_id: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    receipt_show_logo: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    receipt_copies: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
    notify_low_stock_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    branch = relationship("Branch")


class UserInvitation(UUIDMixin, Base):
    __tablename__ = "user_invitations"
    __table_args__ = (
        Index("ix_user_invitations_company_id_otp_hash", "company_id", "otp_hash"),
        Index("ix_user_invitations_expires_at", "expires_at"),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("branches.id"),
        nullable=False,
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("roles.id"),
        nullable=False,
    )
    invited_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    otp_code: Mapped[str] = mapped_column(String(8), nullable=False)
    otp_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )

    branch = relationship("Branch", foreign_keys=[branch_id])
    role = relationship("Role", foreign_keys=[role_id])
    inviter = relationship("User", foreign_keys=[invited_by])
    created_user = relationship("User", foreign_keys=[created_user_id])
