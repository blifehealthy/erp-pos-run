# Restaurant Operations Guide

Last updated: 2026-06-02

## Before Opening

1. Start the local stack and check health.

```bash
docker compose up -d
curl -s http://localhost/health
```

2. Login as staff with branch context.
3. Open `/restaurant/tables` and confirm tables, QR links, and table status.
4. For demo/testing only, seed sample menu, raw materials, and recipes.

```bash
docker compose exec backend python -m app.utils.seed_fnb_demo
```

## Dine-In Flow

1. Staff opens a table from `/restaurant/tables`.
2. Customer scans the table QR and orders from `/menu/:qr_token`.
3. Kitchen works tickets from `/restaurant/kitchen`.
4. Staff marks ready items as served from Session Detail or Kitchen Display.
5. Customer requests bill from mobile, or staff opens checkout.
6. Staff takes payment, enters payment reference when needed, and prints receipt.

## Quick Service Flow

1. Staff generates the Quick Service QR from restaurant settings.
2. Customer scans QR and orders from `/order/:qs_token`.
3. Kitchen marks tickets pending -> cooking -> done.
4. Pickup display `/restaurant/pickup` shows ready queues.
5. Staff closes ready queue from `/restaurant/orders` with `รับเงิน`.

## Kitchen Rules

- Work oldest tickets first.
- Use source filter when the kitchen station separates dine-in and pickup.
- Keep status order: pending -> cooking -> done -> served.
- Special requests should be checked before marking done.

## Recipe And Cost

1. Open `/restaurant/recipes`.
2. Create raw materials from the recipe form when a material is missing.
3. Create or edit recipes for `menu_item` products.
4. Check cost per yield and gross margin.
5. Use `/restaurant/reports/ingredients` for theoretical usage and CSV export.

## End Of Day

1. Check `/restaurant/orders` for open sessions or unpaid queues.
2. Check table map for tables still occupied or bill requested.
3. Export ingredient usage when needed.
4. Run smoke test only in development or staging.

```bash
bash scripts/fnb-smoke.sh
```

## Permission Guide

- Manager: `fb.menu.view`, `fb.table.manage`, `fb.order.create`, `fb.kitchen.manage`, `fb.recipe.manage`, `fb.report.view`, `fb.settings.manage`
- Cashier/service staff: `fb.menu.view`, `fb.table.manage`, `fb.order.create`
- Kitchen staff: `fb.menu.view`, `fb.kitchen.manage`
- Recipe/cost staff: `fb.menu.view`, `fb.recipe.manage`, `fb.report.view`
