from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.api_integration import ExternalOrder, WebhookEndpoint
from app.schemas.api_integration import PublicOrderCreate
from app.utils.rate_limiter import is_webhook_rate_limited

router = APIRouter(prefix="/webhooks", tags=["incoming-webhooks"])


async def resolve_incoming_company(body_bytes: bytes, signature: str, db: AsyncSession) -> WebhookEndpoint | None:
    endpoints = (
        await db.scalars(
            select(WebhookEndpoint).where(
                WebhookEndpoint.is_active.is_(True),
                WebhookEndpoint.secret.is_not(None),
            )
        )
    ).all()
    provided = signature.removeprefix("sha256=")
    for endpoint in endpoints:
        expected = hmac.new(endpoint.secret.encode(), body_bytes, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, provided):
            return endpoint
    return None


@router.post("/blifehealthy/orders")
async def receive_blifehealthy_order(
    request: Request,
    x_blife_signature: str | None = Header(default=None, alias="X-Blife-Signature"),
) -> dict[str, bool]:
    source_ip = request.client.host if request.client else "unknown"
    is_limited, _remaining = await is_webhook_rate_limited(source_ip)
    if is_limited:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    if not x_blife_signature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature required")

    body_bytes = await request.body()
    async with AsyncSessionLocal() as db:
        endpoint = await resolve_incoming_company(body_bytes, x_blife_signature, db)
        if endpoint is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature")
        payload = PublicOrderCreate.model_validate(json.loads(body_bytes.decode("utf-8")))
        existing = await db.scalar(
            select(ExternalOrder).where(
                ExternalOrder.company_id == endpoint.company_id,
                ExternalOrder.source == "blifehealthy",
                ExternalOrder.external_order_id == payload.external_order_id,
            )
        )
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Duplicate external_order_id")
        row = ExternalOrder(
            company_id=endpoint.company_id,
            source="blifehealthy",
            external_order_id=payload.external_order_id,
            status="pending",
            customer_name=payload.customer_name,
            customer_phone=payload.customer_phone,
            customer_email=payload.customer_email,
            customer_address=payload.customer_address,
            items_json=[item.model_dump(mode="json") for item in payload.items],
            total_amount=payload.total_amount,
            payment_method=payload.payment_method,
            payment_status=payload.payment_status,
            notes=payload.notes,
            raw_payload=payload.model_dump(mode="json"),
        )
        db.add(row)
        await db.commit()
    return {"received": True}
