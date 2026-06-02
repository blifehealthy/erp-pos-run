#!/usr/bin/env bash
set -euo pipefail

INTERNAL_BASE_URL="${INTERNAL_BASE_URL:-http://127.0.0.1:8000}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$PROJECT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

psql_at() {
  docker compose exec -T postgres psql -U erp_user -d erp_pos_db -Atc "$1"
}

http_get() {
  docker compose exec -T backend python -c 'import sys, urllib.request; print(urllib.request.urlopen(sys.argv[1]).read().decode())' "$1"
}

http_post_json() {
  docker compose exec -T backend python -c 'import sys, urllib.request; data=sys.argv[2].encode(); req=urllib.request.Request(sys.argv[1], data=data, headers={"Content-Type":"application/json"}, method="POST"); print(urllib.request.urlopen(req).read().decode())' "$1" "$2"
}

json_get() {
  node -e "const fs=require('fs'); const p=process.argv[1].split('.'); let v=JSON.parse(fs.readFileSync(0,'utf8')); for (const k of p) v=v?.[k]; if (v===undefined||v===null) process.exit(2); console.log(v)" "$1"
}

require_cmd docker
require_cmd node

echo "== F&B smoke: health"
http_get "$INTERNAL_BASE_URL/health" >/dev/null

echo "== F&B smoke: seed demo menu"
docker compose exec -T backend python -m app.utils.seed_fnb_demo >/dev/null

QS_TOKEN="$(psql_at "select fb_qs_qr_token from branch_settings where fb_qs_qr_token is not null limit 1;")"
if [[ -z "$QS_TOKEN" ]]; then
  QS_TOKEN="$(psql_at "update branch_settings set fb_qs_qr_token = gen_random_uuid() where id = (select id from branch_settings order by created_at limit 1) returning fb_qs_qr_token;")"
fi
if [[ -z "$QS_TOKEN" ]]; then
  echo "No Quick Service token found and could not create one." >&2
  exit 1
fi

PRODUCT_ID="$(psql_at "select id from products where sku='FNB-DEMO-001' and product_type='menu_item' and is_active=true limit 1;")"
if [[ -z "$PRODUCT_ID" ]]; then
  echo "Demo product FNB-DEMO-001 was not found after seed." >&2
  exit 1
fi

echo "== F&B smoke: public quick-service menu"
MENU_JSON="$(http_get "$INTERNAL_BASE_URL/api/public/qs/$QS_TOKEN")"
PRODUCT_COUNT="$(printf '%s' "$MENU_JSON" | json_get data.products.length)"
if [[ "$PRODUCT_COUNT" -lt 12 ]]; then
  echo "Expected at least 12 demo products, got $PRODUCT_COUNT" >&2
  exit 1
fi

echo "== F&B smoke: place quick-service order"
ORDER_JSON="$(http_post_json "$INTERNAL_BASE_URL/api/public/qs/$QS_TOKEN/orders?customer_name=Smoke%20Test&customer_phone=0800000000" "{\"items\":[{\"product_id\":\"$PRODUCT_ID\",\"qty\":1,\"special_request\":\"smoke test\"}],\"note\":\"smoke script\"}")"
SESSION_ID="$(printf '%s' "$ORDER_JSON" | json_get data.session_id)"
QUEUE_DISPLAY="$(printf '%s' "$ORDER_JSON" | json_get data.queue_display)"

echo "== F&B smoke: public status"
STATUS_JSON="$(http_get "$INTERNAL_BASE_URL/api/public/qs/$QS_TOKEN/status?session_id=$SESSION_ID")"
ITEM_STATUS="$(printf '%s' "$STATUS_JSON" | json_get data.items.0.status)"
if [[ "$ITEM_STATUS" != "pending" ]]; then
  echo "Expected initial item status pending, got $ITEM_STATUS" >&2
  exit 1
fi

ORDER_ITEM_ID="$(printf '%s' "$STATUS_JSON" | json_get data.items.0.id)"
TICKET_ID="$(psql_at "select id from kitchen_tickets where order_item_id='$ORDER_ITEM_ID' limit 1;")"
if [[ -z "$TICKET_ID" ]]; then
  echo "Kitchen ticket was not created for order item $ORDER_ITEM_ID" >&2
  exit 1
fi

echo "== F&B smoke: advance kitchen ticket pending -> cooking -> done"
psql_at "update kitchen_tickets set status='cooking' where id='$TICKET_ID'; update dining_order_items set status='cooking' where id='$ORDER_ITEM_ID';" >/dev/null
STATUS_JSON="$(http_get "$INTERNAL_BASE_URL/api/public/qs/$QS_TOKEN/status?session_id=$SESSION_ID")"
ITEM_STATUS="$(printf '%s' "$STATUS_JSON" | json_get data.items.0.status)"
if [[ "$ITEM_STATUS" != "cooking" ]]; then
  echo "Expected item status cooking, got $ITEM_STATUS" >&2
  exit 1
fi

psql_at "update kitchen_tickets set status='done', done_at=now() where id='$TICKET_ID'; update dining_order_items set status='done' where id='$ORDER_ITEM_ID';" >/dev/null
STATUS_JSON="$(http_get "$INTERNAL_BASE_URL/api/public/qs/$QS_TOKEN/status?session_id=$SESSION_ID")"
ITEM_STATUS="$(printf '%s' "$STATUS_JSON" | json_get data.items.0.status)"
if [[ "$ITEM_STATUS" != "done" ]]; then
  echo "Expected item status done, got $ITEM_STATUS" >&2
  exit 1
fi

echo "== F&B smoke: pickup queue"
PICKUP_SESSION_ID="$(psql_at "select s.id from dining_sessions s where s.id='$SESSION_ID' and s.table_id is null and s.status='open' and exists (select 1 from kitchen_tickets kt where kt.session_id=s.id and kt.status='done') and not exists (select 1 from kitchen_tickets kt where kt.session_id=s.id and kt.status in ('pending','cooking')) limit 1;")"
if [[ "$PICKUP_SESSION_ID" != "$SESSION_ID" ]]; then
  echo "Expected pickup queue to include session $SESSION_ID" >&2
  exit 1
fi

echo "PASS: F&B smoke OK session=$SESSION_ID queue=$QUEUE_DISPLAY ticket=$TICKET_ID"
