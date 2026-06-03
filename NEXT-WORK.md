# Next Work Handoff

Last updated: 2026-06-03

## Current State

- Repo: `https://github.com/blifehealthy/erp-pos-run.git`
- Branch: `main`
- Recent completed feature: Restaurant permission and recipe-cost readiness
- App URL: `http://localhost`
- Restaurant table page: `http://localhost/restaurant/tables`
- Health check: `http://localhost/health`
- Node version for frontend work: use `.nvmrc` (`20.19.0`)

## What Was Completed

- GitHub push is set up and current on `main`.
- `.gitignore` protects `.env`, `.env.*`, `node_modules/`, `dist/`, `build/`, logs, and local Claude config.
- Restaurant mobile ordering UI was shared between dine-in and quick service.
- Dine-in QR customer page has menu search, category tabs, item detail/options, cart sheet, order status, and bill request.
- Quick service QR page has menu search, customer phone, order submission, and queue status.
- Customer mobile ordering now persists carts per QR token, restores order/queue status after refresh, shows readable backend errors, and avoids repeating completion sounds on every polling refresh.
- Public order status endpoints now validate that the requested session belongs to the scanned table QR or quick-service branch token.
- Customer-to-kitchen E2E was validated with a Quick Service public order:
  - session `f01d0351-2b46-4d61-87e7-114722633f93`
  - queue `005`
  - product `ปอเปี๊ยะทอด`
  - kitchen ticket status `pending`
- Kitchen Display now supports source filtering for all/table/quick-service tickets, shows source badges, has a manual refresh button, larger status buttons, stronger special-request treatment, and visible error state.
- Table Map now shows QR-new, kitchen-pending, and ready-to-serve counts on active tables.
- Session Detail now has a status board for pending/cooking/done/served items with served/cancel actions.
- Checkout warning now links staff back to Session Detail or Kitchen Display when items are still pending/cooking.
- Demo F&B menu can be seeded repeatedly with:
  `docker compose exec backend python -m app.utils.seed_fnb_demo`
- F&B smoke script is available:
  `bash scripts/fnb-smoke.sh`
- Restaurant UAT checklist is available in `UAT-RESTAURANT.md`.
- Customer mobile UI was polished for narrow screens:
  - menu thumbnails shrink on very small screens
  - add/customize buttons use smaller mobile sizing
  - cart and item option sheets respect safe-area bottom padding
  - dine-in and quick-service pages show a loading panel while status is fetched
- Playwright screenshot validation was attempted, but `npx playwright` tried to resolve unavailable `playwright@1.60.0`; use manual mobile UAT or fix Playwright package pin before screenshot automation.
- Pickup Display now shows only ready Quick Service queues and includes item count, ready time, loading/refresh indicator, error state, last-updated time, sound toggle, and long-wait highlighting.
- Staff restaurant pages were improved:
  - Table Map summary and bill-requested visibility
  - Table Map QR-new/kitchen/ready counts
  - Kitchen Display urgent/old-first sorting and source filtering
  - Pickup Display queue visibility and ready Quick Service details
  - Orders filters by source/status/date
  - Session Detail with customer/source/order context and status board
  - Checkout invalidation and payment reference support
- Table creation now works with real branch context:
  - TopBar auto-syncs default branch into the auth token when missing.
  - Table Map disables add table until branch context exists.
  - Table create/open/close actions show backend errors.
- Table management actions were added:
  - Edit table name, capacity, and status
  - Copy table QR link
  - Soft deactivate table with confirmation
  - Backend update/delete now require current branch context and block cross-branch edits.
- Open table flow now uses a dialog before creating the session:
  - guest count, default `1`
  - optional customer name
  - optional customer phone
  - backend already stores these fields on `DiningSession`
- Table status guard was added:
  - UI disables `available` status while a table has an active session.
  - Backend rejects setting a table to `available` if it still has an open/bill-requested session.
- QR preview/print was improved:
  - QR dialog shows the customer-facing URL.
  - QR dialog has a copy link button.
  - Print mode prints only the QR table card.
- Cancel order/item flow was added:
  - Staff can cancel a whole order or a single item from Session Detail.
  - Cancellation requires a reason.
  - Served items cannot be cancelled.
  - Cancelled items are excluded from F&B totals and synced to kitchen tickets.
- F&B checkout receipt detail was added:
  - Receipt result includes table name, queue number, source type, customer info, payment method, and note.
  - Checkout success screen shows F&B context and ordered item lines.
  - SaleOrder note includes F&B source context.
- Restaurant receipt print polish was added:
  - Print mode now prints only the receipt body in an 80mm thermal-friendly layout.
  - Receipt header includes receipt title, order number, and print timestamp.
  - PromptPay, transfer, and card payment references can be entered and shown on the receipt.
- Kitchen status and served workflow was tightened:
  - Backend validates status order: pending -> cooking -> done -> served.
  - Session Detail can mark done items as served.
  - Kitchen Display still advances tickets through the same guarded flow.
- F&B E2E smoke now covers both Quick Service and Dine-in:
  - Quick Service public QR menu/order/status, kitchen pending -> cooking -> done, and authenticated pickup queue.
  - Dine-in staff table creation, public QR order/status, kitchen pending -> cooking -> done, served workflow, public bill request, and authenticated checkout/receipt.
- F&B checkout hardening:
  - Auto-created F&B cashier shift number now fits the database column.
  - POS sale stock movement now skips `menu_item` and `raw_material`, matching the F&B design where recipe/ingredient usage is estimated separately.
- Recipe Management for staff now supports editing existing recipes:
  - Staff can update recipe name, yield, notes, and ingredient rows from `/restaurant/recipes`.
  - The menu item binding is locked during edit so a recipe cannot accidentally move to another product.
- Quick Service staff checkout was shortened:
  - `/restaurant/orders` now shows kitchen status counts for each session.
  - Ready Quick Service queues show `พร้อมรับ` and can be closed with `รับเงิน` directly from the Orders list.
  - Staff can choose cash, PromptPay, transfer, card, or other payment and enter a payment reference.
- Pickup Display operational polish was added:
  - Staff can enable/disable chime sound from the display.
  - New ready queues play a chime after sound is enabled.
  - Queues waiting 10+ minutes are highlighted so staff can prioritize handoff.
  - The display shows the last successful refresh time.
- `RESTAURANT-MODULE-PLAN.md` was updated with completed checklist items.
- Restaurant permission separation was tightened:
  - table/session setup uses `fb.table.manage`
  - ordering, bill, checkout, and cancel flow use `fb.order.create`
  - kitchen ticket/status flow uses `fb.kitchen.manage`
  - recipe create/edit/delete and raw material creation use `fb.recipe.manage`
  - Quick Service QR and F&B notification test use `fb.settings.manage`
- Product list API now supports `product_type`, so recipe setup can correctly separate `menu_item` and `raw_material`.
- Demo F&B seed now creates raw materials and sample recipes for recipe/cost testing.
- `/restaurant/recipes` can create a missing raw material inline and immediately append it to the recipe form.
- Staff operations guide was added in `RESTAURANT-OPERATIONS-GUIDE.md`.
- Restaurant permission smoke was added in `scripts/fnb-permission-smoke.sh`:
  - seeds test roles/users for cashier, kitchen, recipe/cost, and manager
  - verifies expected 200/201 and 403 responses against restaurant APIs
  - runs idempotently against the local Docker stack

## Validation Already Run

From `frontend/` with Node 20:

```bash
source /Users/macbook/.nvm/nvm.sh
nvm use
npm run type-check
npm run build
```

Result: passed.

Known build warnings still present:

- CSS minify warning: `Expected identifier but found "-"`
- Vite chunk size warning for large JS bundle

Docker stack was rebuilt/restarted after the latest frontend/backend changes:

```bash
docker compose up -d --build backend
curl -s http://localhost/health
bash scripts/fnb-smoke.sh
```

Result:

- health returned `{"status":"ok","version":"1.0.0"}`
- `docker compose exec -T backend python -m app.utils.seed_fnb_demo` passed:
  - seeded 4 categories, 12 products, 8 raw materials, 4 recipes
- `bash scripts/fnb-smoke.sh` passed:
  - quick-service session `4d48945e-029f-45ae-bbdd-94d4906c31d0`, queue `026`
  - dine-in session `78ed30af-fed5-4d77-b973-c24efbc1f782`, checkout total `178.00`
- Raw material API smoke passed:
  - created SKU `RAW-SMOKE-1780414881` through `/api/v1/restaurant/raw-materials`
- Permission smoke passed on 2026-06-03:
  - `bash scripts/fnb-permission-smoke.sh`
  - company `9790f996-1078-4634-9876-c5a828cbb263`
  - branch `bf037c46-bccd-41ed-b768-97cfa8d30136`
  - raw material SKU `PERM-RAW-1780448829`

## Next Work To Do

Start here next session.

### 1. Manual Visual UAT For Restaurant Screens

- Use the now-passing `bash scripts/fnb-smoke.sh` as the business-flow baseline.
- Manually inspect mobile dine-in and quick-service pages on 320px/390px widths.
- Manually inspect Table Map badges, Kitchen Display filters, Pickup Display readability, Session Detail served/cancel controls, and checkout receipt copy.
- Manually inspect Quick Service `รับเงิน` from `/restaurant/orders` after a queue reaches ready state, including transfer/card reference.
- Manually inspect Pickup Display sound toggle, long-wait highlight, and refresh timestamp on the actual pickup display device.
- Manually inspect `/restaurant/recipes` create/edit/delete and `/restaurant/reports/ingredients` CSV export.
- Note UI friction before moving to recipe/cost work.

### 2. Next Build Items

- Use `scripts/fnb-permission-smoke.sh` as the automated permission baseline, then manually login as the seeded users to inspect frontend route visibility and menu/sidebar behavior.
- Manual visual UAT for `/restaurant/recipes` after demo seed: create raw material, create recipe, edit recipe, delete recipe, and export ingredient usage CSV.
- Test physical/mobile devices on same Wi-Fi using the Mac LAN IP instead of `localhost`.
- Prepare production deployment notes: public URL, HTTPS, QR URL base, printer setup, and backup/restore checklist.
- Decide whether stock count variance should become the next build item after recipe-cost readiness.

Reference checklist:

- `RESTAURANT-MODULE-PLAN.md`

Files likely involved:

- `frontend/src/pages/restaurant/TableMapPage.tsx`
- `frontend/src/pages/restaurant/SessionDetailPage.tsx`
- `frontend/src/pages/restaurant/KitchenDisplayPage.tsx`
- `frontend/src/pages/restaurant/PickupDisplayPage.tsx`

## Commands To Resume

```bash
cd /Users/macbook/erp-pos-run
git status --short --branch
source /Users/macbook/.nvm/nvm.sh
nvm use
cd frontend
npm run type-check
npm run build
```

If code changes need to show on `http://localhost`:

```bash
cd /Users/macbook/erp-pos-run
docker compose up -d --build frontend nginx
curl -s http://localhost/health
```

Commit/push convention used so far:

```bash
git add <changed-files>
git commit -m "<concise message>"
git push
```

Do not force push.
