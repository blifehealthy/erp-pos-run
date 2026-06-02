# Next Work Handoff

Last updated: 2026-06-02

## Current State

- Repo: `https://github.com/blifehealthy/erp-pos-run.git`
- Branch: `main`
- Recent completed feature: Staff order control, checkout warning, and reusable demo menu seed
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
- Staff restaurant pages were improved:
  - Table Map summary and bill-requested visibility
  - Table Map QR-new/kitchen/ready counts
  - Kitchen Display urgent/old-first sorting and source filtering
  - Pickup Display queue visibility
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
- Kitchen status and served workflow was tightened:
  - Backend validates status order: pending -> cooking -> done -> served.
  - Session Detail can mark done items as served.
  - Kitchen Display still advances tickets through the same guarded flow.
- `RESTAURANT-MODULE-PLAN.md` was updated with completed checklist items.

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
docker compose up -d --build frontend nginx
curl -s http://localhost/health
```

Result: health returned `{"status":"ok","version":"1.0.0"}`.

## Next Work To Do

Start here next session.

### 1. Test F&B End-to-End Flow

- Run a manual dine-in flow: create/open table -> customer/staff order -> kitchen transitions -> served -> checkout -> receipt.
- Run a manual quick-service flow: QR order -> kitchen transitions -> pickup display -> checkout/order history.
- Note any UI friction or missing staff actions before moving to broader POS polish.

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
