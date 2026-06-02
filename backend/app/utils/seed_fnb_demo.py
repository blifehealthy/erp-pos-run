from __future__ import annotations

import argparse
import asyncio
from decimal import Decimal
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.branch import Branch
from app.models.company import Company
from app.models.product import Category, Product, Unit


DEMO_CATEGORIES: list[dict[str, object]] = [
    {"code": "FNB-DEMO-APP", "name": "อาหารทานเล่น", "sort_order": 10},
    {"code": "FNB-DEMO-MAIN", "name": "จานหลัก", "sort_order": 20},
    {"code": "FNB-DEMO-DRINK", "name": "เครื่องดื่ม", "sort_order": 30},
    {"code": "FNB-DEMO-DESSERT", "name": "ของหวาน", "sort_order": 40},
]

DEMO_PRODUCTS: list[dict[str, object]] = [
    {"sku": "FNB-DEMO-001", "name": "ปอเปี๊ยะทอด", "description": "ปอเปี๊ยะทอดไส้ผัก เสิร์ฟพร้อมน้ำจิ้มบ๊วย", "price": Decimal("89"), "category_code": "FNB-DEMO-APP"},
    {"sku": "FNB-DEMO-002", "name": "ไก่ทอดสมุนไพร", "description": "ไก่ทอดกรอบ โรยสมุนไพรและหอมเจียว", "price": Decimal("129"), "category_code": "FNB-DEMO-APP"},
    {"sku": "FNB-DEMO-003", "name": "ยำวุ้นเส้นทะเล", "description": "ยำรสจัดพร้อมกุ้ง ปลาหมึก และหมูสับ", "price": Decimal("159"), "category_code": "FNB-DEMO-APP"},
    {"sku": "FNB-DEMO-004", "name": "ข้าวกะเพราเนื้อไข่ดาว", "description": "กะเพราเนื้อสับรสจัด เสิร์ฟพร้อมไข่ดาว", "price": Decimal("169"), "category_code": "FNB-DEMO-MAIN"},
    {"sku": "FNB-DEMO-005", "name": "ข้าวผัดต้มยำกุ้ง", "description": "ข้าวผัดต้มยำกุ้งหอมเครื่องสมุนไพร", "price": Decimal("149"), "category_code": "FNB-DEMO-MAIN"},
    {"sku": "FNB-DEMO-006", "name": "สเต๊กปลาแซลมอน", "description": "แซลมอนย่าง เสิร์ฟพร้อมผักและซอสเลมอนบัตเตอร์", "price": Decimal("289"), "category_code": "FNB-DEMO-MAIN"},
    {"sku": "FNB-DEMO-007", "name": "ลาเต้เย็น", "description": "กาแฟลาเต้เย็น หวานมันกำลังดี", "price": Decimal("95"), "category_code": "FNB-DEMO-DRINK"},
    {"sku": "FNB-DEMO-008", "name": "ชาไทยเย็น", "description": "ชาไทยเข้มข้น หอมมัน", "price": Decimal("75"), "category_code": "FNB-DEMO-DRINK"},
    {"sku": "FNB-DEMO-009", "name": "น้ำผึ้งมะนาวโซดา", "description": "สดชื่น เปรี้ยวหวาน พร้อมโซดา", "price": Decimal("85"), "category_code": "FNB-DEMO-DRINK"},
    {"sku": "FNB-DEMO-010", "name": "บัวลอยมะพร้าวอ่อน", "description": "บัวลอยน้ำกะทิพร้อมเนื้อมะพร้าวอ่อน", "price": Decimal("89"), "category_code": "FNB-DEMO-DESSERT"},
    {"sku": "FNB-DEMO-011", "name": "บราวนี่ไอศกรีม", "description": "บราวนี่อุ่น เสิร์ฟคู่ไอศกรีมวานิลลา", "price": Decimal("129"), "category_code": "FNB-DEMO-DESSERT"},
    {"sku": "FNB-DEMO-012", "name": "ข้าวเหนียวมะม่วง", "description": "ข้าวเหนียวมูนและมะม่วงสุกตามฤดูกาล", "price": Decimal("139"), "category_code": "FNB-DEMO-DESSERT"},
]


async def _resolve_company(db: AsyncSession, company_id: str | None) -> Company:
    if company_id:
        company = await db.get(Company, uuid.UUID(company_id))
    else:
        company = await db.scalar(select(Company).where(Company.is_active.is_(True)).order_by(Company.created_at).limit(1))
    if not company:
        raise RuntimeError("No active company found")
    return company


async def _resolve_branch(db: AsyncSession, company: Company, branch_id: str | None) -> Branch:
    if branch_id:
        branch = await db.get(Branch, uuid.UUID(branch_id))
    else:
        branch = await db.scalar(
            select(Branch)
            .where(Branch.company_id == company.id, Branch.is_active.is_(True), Branch.deleted_at.is_(None))
            .order_by(Branch.sort_order, Branch.created_at)
            .limit(1)
        )
    if not branch or branch.company_id != company.id:
        raise RuntimeError("No active branch found for company")
    return branch


async def seed_fnb_demo_menu(db: AsyncSession, company_id: str | None = None, branch_id: str | None = None) -> tuple[int, int]:
    company = await _resolve_company(db, company_id)
    await _resolve_branch(db, company, branch_id)

    unit = await db.scalar(
        select(Unit).where(Unit.company_id == company.id, Unit.code == "PCS", Unit.deleted_at.is_(None)).limit(1)
    )
    if not unit:
        unit = Unit(company_id=company.id, code="PCS", name="ชิ้น", name_en="Piece", decimal_places=0, is_active=True)
        db.add(unit)
        await db.flush()

    for item in DEMO_CATEGORIES:
        category = await db.scalar(
            select(Category).where(Category.company_id == company.id, Category.code == item["code"], Category.deleted_at.is_(None))
        )
        if category:
            category.name = str(item["name"])
            category.sort_order = int(item["sort_order"])
            category.is_active = True
        else:
            db.add(Category(company_id=company.id, is_active=True, **item))
    await db.flush()

    categories = list((await db.scalars(select(Category).where(Category.company_id == company.id, Category.code.in_([str(c["code"]) for c in DEMO_CATEGORIES])))).all())
    category_map = {category.code: category.id for category in categories}

    product_values = [
        {
            "company_id": company.id,
            "sku": item["sku"],
            "name": item["name"],
            "description": item["description"],
            "category_id": category_map.get(str(item["category_code"])),
            "unit_id": unit.id,
            "product_type": "menu_item",
            "cost_price": Decimal("0"),
            "selling_price": item["price"],
            "vat_type": "included",
            "vat_rate": Decimal("7.00"),
            "is_active": True,
            "is_for_sale": True,
            "is_for_purchase": False,
        }
        for item in DEMO_PRODUCTS
    ]
    product_statement = insert(Product).values(product_values)
    product_statement = product_statement.on_conflict_do_update(
        index_elements=["company_id", "sku"],
        set_={
            "name": product_statement.excluded.name,
            "description": product_statement.excluded.description,
            "category_id": product_statement.excluded.category_id,
            "unit_id": product_statement.excluded.unit_id,
            "product_type": "menu_item",
            "selling_price": product_statement.excluded.selling_price,
            "is_active": True,
            "is_for_sale": True,
            "is_for_purchase": False,
        },
    )
    await db.execute(product_statement)
    await db.commit()
    return len(DEMO_CATEGORIES), len(DEMO_PRODUCTS)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo F&B menu categories and products.")
    parser.add_argument("--company-id", default=None)
    parser.add_argument("--branch-id", default=None)
    args = parser.parse_args()

    async with AsyncSessionLocal() as db:
        category_count, product_count = await seed_fnb_demo_menu(db, args.company_id, args.branch_id)
        print(f"Seeded demo F&B menu: {category_count} categories, {product_count} products")


if __name__ == "__main__":
    asyncio.run(main())
