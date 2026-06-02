from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class Recipe(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "recipes"
    __table_args__ = (
        UniqueConstraint("product_id", "branch_id", name="uq_recipes_product_branch"),
        Index("ix_recipes_company_id", "company_id"),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id"),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("branches.id"),
        nullable=True,
        index=True,
        comment="NULL = ใช้ทุกสาขา, มีค่า = สูตรเฉพาะสาขา",
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    yield_qty: Mapped[Decimal] = mapped_column(
        Numeric(10, 4),
        nullable=False,
        server_default=text("1"),
        comment="ปริมาณที่ได้ต่อ 1 ครั้งที่ทำสูตรนี้",
    )
    yield_unit: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        server_default=text("'แก้ว'"),
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )

    product: Mapped["Product"] = relationship("Product")  # type: ignore[name-defined]
    branch: Mapped["Branch | None"] = relationship("Branch")  # type: ignore[name-defined]
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        "RecipeIngredient",
        back_populates="recipe",
        cascade="all, delete-orphan",
        order_by="RecipeIngredient.sort_order.asc()",
    )


class DiningTable(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "dining_tables"
    __table_args__ = (Index("ix_dining_tables_branch_id", "branch_id"),)

    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("4"))
    qr_token: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True, server_default=text("gen_random_uuid()"))
    table_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'dine_in'"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'available'"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    sessions: Mapped[list["DiningSession"]] = relationship("DiningSession", back_populates="table")


class DiningSession(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "dining_sessions"
    __table_args__ = (Index("ix_dining_sessions_branch_id", "branch_id"),)

    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    table_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("dining_tables.id"), nullable=True)
    shift_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("cashier_shifts.id"), nullable=True)
    opened_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    queue_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    queue_date: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="YYYY-MM-DD สำหรับ reset รายวัน")
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'open'"))
    guest_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sale_order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sale_orders.id"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    table: Mapped["DiningTable | None"] = relationship("DiningTable", back_populates="sessions")
    orders: Mapped[list["DiningOrder"]] = relationship("DiningOrder", back_populates="session")


class DiningOrder(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "dining_orders"
    __table_args__ = (Index("ix_dining_orders_session_id", "session_id"),)

    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dining_sessions.id"), nullable=False)
    order_number: Mapped[str] = mapped_column(String(50), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'qr_self'"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped["DiningSession"] = relationship("DiningSession", back_populates="orders")
    items: Mapped[list["DiningOrderItem"]] = relationship("DiningOrderItem", back_populates="order", cascade="all, delete-orphan")


class DiningOrderItem(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "dining_order_items"

    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dining_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    product_name: Mapped[str] = mapped_column(String(500), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False, server_default=text("0"))
    special_request: Mapped[str | None] = mapped_column(String(500), nullable=True)
    station: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'"))

    order: Mapped["DiningOrder"] = relationship("DiningOrder", back_populates="items")
    product: Mapped["Product"] = relationship("Product")  # type: ignore[name-defined]


class KitchenTicket(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "kitchen_tickets"
    __table_args__ = (
        Index("ix_kitchen_tickets_branch_status", "branch_id", "status"),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dining_sessions.id"), nullable=False, index=True)
    order_item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dining_order_items.id"), nullable=False, unique=True)
    product_name: Mapped[str] = mapped_column(String(500), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    special_request: Mapped[str | None] = mapped_column(String(500), nullable=True)
    station: Mapped[str | None] = mapped_column(String(50), nullable=True)
    queue_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    table_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'pending'"))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order_item: Mapped["DiningOrderItem"] = relationship("DiningOrderItem")


class RecipeIngredient(UUIDMixin, Base):
    __tablename__ = "recipe_ingredients"
    __table_args__ = (
        Index("ix_recipe_ingredients_recipe_id", "recipe_id"),
        Index("ix_recipe_ingredients_ingredient_id", "ingredient_id"),
    )

    recipe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recipes.id", ondelete="CASCADE"),
        nullable=False,
    )
    ingredient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id"),
        nullable=False,
        comment="FK → products ที่มี product_type = raw_material",
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(12, 4),
        nullable=False,
        comment="ปริมาณที่ใช้ต่อ 1 yield",
    )
    unit: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        comment="g / ml / ชิ้น / ช้อนชา",
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)

    recipe: Mapped["Recipe"] = relationship("Recipe", back_populates="ingredients")
    ingredient: Mapped["Product"] = relationship("Product", foreign_keys=[ingredient_id])  # type: ignore[name-defined]
