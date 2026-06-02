# Next Work Handoff

Last updated: 2026-06-02

## Current State

- Repo: `https://github.com/blifehealthy/erp-pos-run.git`
- Branch: `main`
- Latest commit: `81cdc70 add restaurant table management actions`
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
- Staff restaurant pages were improved:
  - Table Map summary and bill-requested visibility
  - Kitchen Display urgent/old-first sorting
  - Pickup Display queue visibility
  - Orders filters by source/status/date
  - Session Detail with customer/source/order context
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

### 1. Improve Open Table Flow

Current behavior:

- On Table Map, clicking `เปิดโต๊ะ` immediately calls:
  - `POST /api/v1/restaurant/sessions`
  - payload: `{ table_id, guest_count: 1 }`

Needed:

- Add an `Open Table` dialog before opening session.
- Fields:
  - guest count, default `1`
  - customer name, optional
  - customer phone, optional
- Validate guest count > 0.
- Submit payload:

```ts
{
  table_id: table.id,
  guest_count: Number(guestCount),
  customer_name: customerName.trim() || undefined,
  customer_phone: customerPhone.trim() || undefined
}
```

Files likely involved:

- `frontend/src/pages/restaurant/TableMapPage.tsx`
- Backend already supports this in `SessionOpen`:
  - `backend/app/schemas/restaurant.py`
  - `backend/app/routers/restaurant.py`

### 2. Add Table Status Guard In Edit Dialog

Current behavior:

- Edit dialog allows manual status selection: `available`, `occupied`, `bill_requested`, `cleaning`.

Needed:

- Avoid allowing staff to manually set `available` if the table has an active session.
- Consider hiding status field or limiting it to `cleaning`/current status when `active_session_id` exists.
- Keep backend behavior consistent if needed.

### 3. Add Better QR Print/Preview

Current behavior:

- QR dialog displays QR and uses `window.print()`.

Needed:

- Add visible QR URL text.
- Add copy button in QR dialog.
- Improve print view so it prints only the QR/table card, not the whole app.

Files likely involved:

- `frontend/src/pages/restaurant/TableMapPage.tsx`
- Possibly global print CSS in `frontend/src/index.css`

### 4. Continue F&B Order Lifecycle

After open-table flow:

- Add cancel order/item flow with required reason.
- Add F&B receipt details showing table/queue/source.
- Review kitchen status transitions and served workflow.

Reference checklist:

- `RESTAURANT-MODULE-PLAN.md`

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
