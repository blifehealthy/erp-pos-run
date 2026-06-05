from __future__ import annotations

import asyncio
from datetime import timedelta
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi import UploadFile


def configure_test_env() -> None:
    values = {
        "POSTGRES_DB": "erp_pos_db",
        "POSTGRES_USER": "erp_user",
        "POSTGRES_PASSWORD": "DummyTestPassword12345!",
        "POSTGRES_HOST": "postgres",
        "POSTGRES_PORT": "5432",
        "DATABASE_URL": "postgresql+asyncpg://erp_user:DummyTestPassword12345!@postgres:5432/erp_pos_db",
        "REDIS_URL": "redis://redis:6379/0",
        "SECRET_KEY": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "ALGORITHM": "HS256",
        "ACCESS_TOKEN_EXPIRE_MINUTES": "480",
        "REFRESH_TOKEN_EXPIRE_DAYS": "30",
        "ENVIRONMENT": "test",
        "CORS_ORIGINS": '["http://localhost"]',
        "APP_NAME": "ERP-POS",
        "APP_VERSION": "test",
        "CELERY_BROKER_URL": "redis://redis:6379/1",
        "CELERY_RESULT_BACKEND": "redis://redis:6379/2",
        "UPLOAD_DIR": tempfile.mkdtemp(prefix="erp-pos-test-uploads-"),
        "MAX_UPLOAD_SIZE_MB": "5",
        "ALLOWED_UPLOAD_EXTENSIONS": '[".jpg",".jpeg",".png",".webp"]',
        "ALLOWED_UPLOAD_MIME_TYPES": '["image/jpeg","image/png","image/webp"]',
    }
    for key, value in values.items():
        os.environ.setdefault(key, value)


configure_test_env()

from app.config import Settings  # noqa: E402
from app.main import health_check, health_live, health_ready  # noqa: E402
from app.services import upload_service as upload_module  # noqa: E402
from app.services.upload_service import UploadService  # noqa: E402
from app.utils import security  # noqa: E402


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def make_upload(filename: str, content: bytes, content_type: str = "image/png") -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(content), headers={"content-type": content_type})


class SecurityRegressionTests(unittest.TestCase):
    def test_access_token_round_trip_uses_pyjwt(self) -> None:
        token = security.create_access_token(
            subject="user-1",
            company_id="company-1",
            branch_id="branch-1",
            permissions=["product.read"],
        )

        payload = security.decode_token(token)

        self.assertEqual(payload["sub"], "user-1")
        self.assertEqual(payload["company_id"], "company-1")
        self.assertEqual(payload["branch_id"], "branch-1")
        self.assertEqual(payload["permissions"], ["product.read"])
        self.assertEqual(payload["type"], "access")

    def test_invalid_token_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            security.decode_token("not-a-token")
        self.assertEqual(ctx.exception.status_code, 401)

    def test_expired_token_is_rejected(self) -> None:
        token = security.create_access_token(
            subject="user-1",
            company_id="company-1",
            branch_id=None,
            permissions=[],
            expires_delta=timedelta(seconds=-1),
        )

        with self.assertRaises(HTTPException) as ctx:
            security.decode_token(token)
        self.assertEqual(ctx.exception.status_code, 401)


class ApiDocsConfigRegressionTests(unittest.TestCase):
    def test_api_docs_disabled_when_production_false_flag(self) -> None:
        settings = Settings(
            postgres_db="erp",
            postgres_user="erp",
            postgres_password="secret",
            postgres_host="postgres",
            postgres_port=5432,
            database_url="postgresql+asyncpg://erp:secret@postgres:5432/erp",
            redis_url="redis://redis:6379/0",
            secret_key="x" * 64,
            algorithm="HS256",
            access_token_expire_minutes=30,
            refresh_token_expire_days=7,
            environment="production",
            cors_origins=["https://erp.internal.test"],
            app_name="ERP-POS",
            app_version="test",
            enable_api_docs=False,
            celery_broker_url="redis://redis:6379/1",
            celery_result_backend="redis://redis:6379/2",
        )

        self.assertFalse(settings.api_docs_enabled)

    def test_api_docs_enabled_by_default_outside_production(self) -> None:
        settings = Settings(
            postgres_db="erp",
            postgres_user="erp",
            postgres_password="secret",
            postgres_host="postgres",
            postgres_port=5432,
            database_url="postgresql+asyncpg://erp:secret@postgres:5432/erp",
            redis_url="redis://redis:6379/0",
            secret_key="x" * 64,
            algorithm="HS256",
            access_token_expire_minutes=30,
            refresh_token_expire_days=7,
            environment="development",
            cors_origins=["http://localhost"],
            app_name="ERP-POS",
            app_version="test",
            celery_broker_url="redis://redis:6379/1",
            celery_result_backend="redis://redis:6379/2",
        )

        self.assertTrue(settings.api_docs_enabled)


class HealthRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_and_liveness_remain_simple_ok_responses(self) -> None:
        self.assertEqual(await health_check(), {"status": "ok", "version": "test"})
        self.assertEqual(await health_live(), {"status": "ok", "version": "test"})

    async def test_readiness_reports_safe_check_names(self) -> None:
        async def ok_async() -> str:
            return "ok"

        with patch("app.main._check_database", ok_async), patch("app.main._check_redis", ok_async):
            response = await health_ready()

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'"database":{"status":"ok"}', response.body)
        self.assertIn(b'"redis":{"status":"ok"}', response.body)
        self.assertIn(b'"uploads":{"status":"ok"}', response.body)


class UploadRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.service = UploadService(upload_dir=self.temp_dir.name)
        self.max_size_patch = patch.object(upload_module.settings, "max_upload_size_mb", 5)
        self.max_size_patch.start()

    async def asyncTearDown(self) -> None:
        self.max_size_patch.stop()
        self.temp_dir.cleanup()

    async def test_valid_upload_writes_uuid_named_file(self) -> None:
        url = await self.service.save_image(make_upload("product.png", PNG_BYTES), "products", "company-1")

        self.assertRegex(url, r"^/uploads/products/company-1/[0-9a-f-]+\.png$")
        saved = Path(self.temp_dir.name, url.removeprefix("/uploads/"))
        self.assertTrue(saved.exists())
        self.assertEqual(saved.read_bytes(), PNG_BYTES)

    async def test_path_traversal_filename_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            await self.service.save_image(make_upload("../product.png", PNG_BYTES), "products", "company-1")
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_dangerous_extension_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            await self.service.save_image(make_upload("product.php", PNG_BYTES), "products", "company-1")
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_oversized_file_is_rejected(self) -> None:
        self.max_size_patch.stop()
        with patch.object(upload_module.settings, "max_upload_size_mb", 0):
            with self.assertRaises(HTTPException) as ctx:
                await self.service.save_image(make_upload("product.png", PNG_BYTES), "products", "company-1")
        self.assertEqual(ctx.exception.status_code, 400)


class WeasyPrintRegressionTests(unittest.TestCase):
    def test_minimal_pdf_render_starts_with_pdf_header(self) -> None:
        from weasyprint import HTML

        pdf = HTML(string="<h1>ERP POS</h1>").write_pdf()

        self.assertGreater(len(pdf), 100)
        self.assertTrue(pdf.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
