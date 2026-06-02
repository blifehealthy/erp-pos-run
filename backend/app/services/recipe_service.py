from __future__ import annotations

from decimal import Decimal
from datetime import date
import uuid

from sqlalchemy import select, and_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.product import Product
from app.models.purchase import PurchaseOrder, PurchaseOrderItem
from app.models.restaurant import Recipe, RecipeIngredient
from app.models.pos import SaleOrder, SaleOrderItem
from app.schemas.restaurant import (
    RecipeCreate,
    RecipeUpdate,
    RecipeIngredientRead,
    RecipeListItem,
    RecipeRead,
    IngredientUsageItem,
    IngredientUsageReport,
)


class RecipeService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def _latest_unit_cost(self, company_id: uuid.UUID, ingredient_id: uuid.UUID) -> Decimal:
        """ดึงราคาต่อหน่วยล่าสุดจาก PurchaseOrderItem"""
        row = await self.db.scalar(
            select(PurchaseOrderItem.unit_cost)
            .join(PurchaseOrder, PurchaseOrderItem.po_id == PurchaseOrder.id)
            .where(
                PurchaseOrderItem.company_id == company_id,
                PurchaseOrderItem.product_id == ingredient_id,
                PurchaseOrder.status == "received",
            )
            .order_by(desc(PurchaseOrder.created_at))
            .limit(1)
        )
        if row is not None:
            return Decimal(str(row))
        # fallback: ดึงจาก cost_price ของ Product
        cost = await self.db.scalar(
            select(Product.cost_price).where(Product.id == ingredient_id)
        )
        return Decimal(str(cost or 0))

    async def _enrich_recipe(self, recipe: Recipe, company_id: uuid.UUID) -> RecipeRead:
        product = recipe.product
        total_cost = Decimal("0")
        ingredients_out: list[RecipeIngredientRead] = []

        for ing in recipe.ingredients:
            unit_cost = await self._latest_unit_cost(company_id, ing.ingredient_id)
            cost_line = (ing.quantity * unit_cost).quantize(Decimal("0.0001"))
            total_cost += cost_line
            ingredients_out.append(
                RecipeIngredientRead(
                    id=ing.id,
                    recipe_id=ing.recipe_id,
                    ingredient_id=ing.ingredient_id,
                    ingredient_name=ing.ingredient.name if ing.ingredient else "",
                    ingredient_sku=ing.ingredient.sku if ing.ingredient else "",
                    quantity=ing.quantity,
                    unit=ing.unit,
                    sort_order=ing.sort_order,
                    notes=ing.notes,
                    latest_unit_cost=unit_cost,
                    cost_per_recipe=cost_line,
                )
            )

        cost_per_yield = (total_cost / recipe.yield_qty).quantize(Decimal("0.01")) if recipe.yield_qty else total_cost
        selling_price = Decimal(str(product.selling_price)) if product else Decimal("0")
        margin = (
            ((selling_price - cost_per_yield) / selling_price * 100).quantize(Decimal("0.01"))
            if selling_price > 0
            else Decimal("0")
        )

        return RecipeRead(
            id=recipe.id,
            company_id=recipe.company_id,
            branch_id=recipe.branch_id,
            product_id=recipe.product_id,
            product_name=product.name if product else "",
            product_sku=product.sku if product else "",
            name=recipe.name,
            yield_qty=recipe.yield_qty,
            yield_unit=recipe.yield_unit,
            notes=recipe.notes,
            is_active=recipe.is_active,
            ingredients=ingredients_out,
            total_cost=total_cost.quantize(Decimal("0.01")),
            cost_per_yield=cost_per_yield,
            selling_price=selling_price,
            gross_margin_pct=margin,
        )

    async def list_recipes(
        self,
        company_id: uuid.UUID,
        branch_id: uuid.UUID | None = None,
        include_inactive: bool = False,
    ) -> list[RecipeListItem]:
        q = (
            select(Recipe)
            .options(selectinload(Recipe.product), selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient))
            .where(Recipe.company_id == company_id)
        )
        if branch_id:
            q = q.where(
                (Recipe.branch_id == branch_id) | (Recipe.branch_id.is_(None))
            )
        if not include_inactive:
            q = q.where(Recipe.is_active.is_(True))

        rows = (await self.db.scalars(q)).all()
        result: list[RecipeListItem] = []
        for recipe in rows:
            enriched = await self._enrich_recipe(recipe, company_id)
            result.append(
                RecipeListItem(
                    id=enriched.id,
                    product_id=enriched.product_id,
                    product_name=enriched.product_name,
                    name=enriched.name,
                    yield_unit=enriched.yield_unit,
                    is_active=enriched.is_active,
                    total_cost=enriched.total_cost,
                    selling_price=enriched.selling_price,
                    gross_margin_pct=enriched.gross_margin_pct,
                )
            )
        return result

    async def get_recipe(self, recipe_id: uuid.UUID, company_id: uuid.UUID) -> Recipe | None:
        return await self.db.scalar(
            select(Recipe)
            .options(
                selectinload(Recipe.product),
                selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient),
            )
            .where(Recipe.id == recipe_id, Recipe.company_id == company_id)
        )

    async def get_recipe_by_product(
        self,
        product_id: uuid.UUID,
        company_id: uuid.UUID,
        branch_id: uuid.UUID | None = None,
    ) -> Recipe | None:
        """ดึงสูตรที่ match branch ก่อน ถ้าไม่มีใช้สูตร global"""
        if branch_id:
            branch_recipe = await self.db.scalar(
                select(Recipe)
                .options(selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient))
                .where(
                    Recipe.product_id == product_id,
                    Recipe.company_id == company_id,
                    Recipe.branch_id == branch_id,
                    Recipe.is_active.is_(True),
                )
            )
            if branch_recipe:
                return branch_recipe
        return await self.db.scalar(
            select(Recipe)
            .options(selectinload(Recipe.ingredients).selectinload(RecipeIngredient.ingredient))
            .where(
                Recipe.product_id == product_id,
                Recipe.company_id == company_id,
                Recipe.branch_id.is_(None),
                Recipe.is_active.is_(True),
            )
        )

    async def create_recipe(self, company_id: uuid.UUID, payload: RecipeCreate) -> Recipe:
        recipe = Recipe(
            company_id=company_id,
            branch_id=payload.branch_id,
            product_id=payload.product_id,
            name=payload.name,
            yield_qty=payload.yield_qty,
            yield_unit=payload.yield_unit,
            notes=payload.notes,
        )
        self.db.add(recipe)
        await self.db.flush()

        for idx, ing_data in enumerate(payload.ingredients):
            ing = RecipeIngredient(
                recipe_id=recipe.id,
                ingredient_id=ing_data.ingredient_id,
                quantity=ing_data.quantity,
                unit=ing_data.unit,
                sort_order=ing_data.sort_order if ing_data.sort_order else idx,
                notes=ing_data.notes,
            )
            self.db.add(ing)

        await self.db.commit()
        await self.db.refresh(recipe)
        return await self.get_recipe(recipe.id, company_id)  # type: ignore[return-value]

    async def update_recipe(
        self,
        recipe: Recipe,
        company_id: uuid.UUID,
        payload: RecipeUpdate,
    ) -> Recipe:
        if payload.name is not None:
            recipe.name = payload.name
        if payload.yield_qty is not None:
            recipe.yield_qty = payload.yield_qty
        if payload.yield_unit is not None:
            recipe.yield_unit = payload.yield_unit
        if payload.notes is not None:
            recipe.notes = payload.notes
        if payload.is_active is not None:
            recipe.is_active = payload.is_active

        if payload.ingredients is not None:
            # replace all ingredients
            for ing in recipe.ingredients:
                await self.db.delete(ing)
            await self.db.flush()
            for idx, ing_data in enumerate(payload.ingredients):
                ing = RecipeIngredient(
                    recipe_id=recipe.id,
                    ingredient_id=ing_data.ingredient_id,
                    quantity=ing_data.quantity,
                    unit=ing_data.unit,
                    sort_order=ing_data.sort_order if ing_data.sort_order else idx,
                    notes=ing_data.notes,
                )
                self.db.add(ing)

        await self.db.commit()
        return await self.get_recipe(recipe.id, company_id)  # type: ignore[return-value]

    async def delete_recipe(self, recipe: Recipe) -> None:
        await self.db.delete(recipe)
        await self.db.commit()

    async def get_ingredient_usage_report(
        self,
        company_id: uuid.UUID,
        branch_id: uuid.UUID,
        date_from: date,
        date_to: date,
    ) -> IngredientUsageReport:
        """คำนวณการใช้วัตถุดิบจาก SaleOrderItems × Recipe ingredients"""
        sales_q = (
            select(SaleOrderItem.product_id, func.sum(SaleOrderItem.qty).label("total_qty"))
            .join(SaleOrder, SaleOrderItem.order_id == SaleOrder.id)
            .where(
                SaleOrder.company_id == company_id,
                SaleOrder.branch_id == branch_id,
                SaleOrder.status.in_(["completed", "partially_refunded"]),
                func.date(SaleOrder.created_at) >= date_from,
                func.date(SaleOrder.created_at) <= date_to,
            )
            .group_by(SaleOrderItem.product_id)
        )
        sold_rows = (await self.db.execute(sales_q)).all()

        # ingredient_id → {qty, unit, name, sku}
        usage: dict[uuid.UUID, dict] = {}

        for product_id, total_qty in sold_rows:
            recipe = await self.get_recipe_by_product(product_id, company_id, branch_id)
            if not recipe:
                continue
            sold = Decimal(str(total_qty)) / recipe.yield_qty
            for ing in recipe.ingredients:
                theoretical = (ing.quantity * sold).quantize(Decimal("0.0001"))
                if ing.ingredient_id not in usage:
                    usage[ing.ingredient_id] = {
                        "name": ing.ingredient.name if ing.ingredient else "",
                        "sku": ing.ingredient.sku if ing.ingredient else "",
                        "unit": ing.unit,
                        "qty": Decimal("0"),
                    }
                usage[ing.ingredient_id]["qty"] += theoretical

        items: list[IngredientUsageItem] = []
        grand_total = Decimal("0")
        for ingredient_id, data in usage.items():
            unit_cost = await self._latest_unit_cost(company_id, ingredient_id)
            total_cost = (data["qty"] * unit_cost).quantize(Decimal("0.01"))
            grand_total += total_cost
            items.append(
                IngredientUsageItem(
                    ingredient_id=ingredient_id,
                    ingredient_name=data["name"],
                    ingredient_sku=data["sku"],
                    theoretical_qty=data["qty"].quantize(Decimal("0.0001")),
                    unit=data["unit"],
                    latest_unit_cost=unit_cost,
                    total_cost=total_cost,
                )
            )

        items.sort(key=lambda x: x.total_cost, reverse=True)
        return IngredientUsageReport(
            branch_id=branch_id,
            date_from=str(date_from),
            date_to=str(date_to),
            items=items,
            grand_total_cost=grand_total.quantize(Decimal("0.01")),
        )
