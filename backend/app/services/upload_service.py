from __future__ import annotations

import os
from pathlib import Path
import uuid

import aiofiles
from fastapi import HTTPException, UploadFile, status
import magic

from app.config import settings


class UploadService:
    dangerous_extensions = {".exe", ".sh", ".php", ".js", ".html", ".htm", ".bat", ".cmd", ".com", ".scr"}

    def __init__(self, upload_dir: str = settings.upload_dir):
        self.upload_dir = Path(upload_dir)

    async def save_image(self, file: UploadFile, subfolder: str, company_id: str) -> str:
        original_name = file.filename or "upload.bin"
        if self._has_path_traversal(original_name):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid filename",
            )

        suffix = Path(original_name).suffix.lower()
        allowed_extensions = {ext.lower() for ext in settings.allowed_upload_extensions}
        if suffix in self.dangerous_extensions or suffix not in allowed_extensions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported file extension",
            )

        contents = await file.read()
        content_type = file.content_type or ""
        detected_type = magic.from_buffer(contents, mime=True)
        allowed_types = set(settings.allowed_upload_mime_types)

        if content_type not in allowed_types or detected_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported image type",
            )

        max_size = settings.max_upload_size_mb * 1024 * 1024
        if len(contents) > max_size:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File exceeds maximum size",
            )

        safe_subfolder = self._safe_path_segment(subfolder, "subfolder")
        safe_company_id = self._safe_path_segment(company_id, "company_id")
        target_dir = self.upload_dir / safe_subfolder / safe_company_id
        target_dir.mkdir(parents=True, exist_ok=True)
        upload_root = self.upload_dir.resolve()
        target_dir_resolved = target_dir.resolve()
        if not target_dir_resolved.is_relative_to(upload_root):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid upload path",
            )

        target_path = self._new_target_path(target_dir_resolved, suffix)

        async with aiofiles.open(target_path, "wb") as buffer:
            await buffer.write(contents)

        return f"/uploads/{safe_subfolder}/{safe_company_id}/{target_path.name}"

    async def delete_image(self, url: str) -> None:
        normalized = url.lstrip("/")
        if not normalized.startswith("uploads/"):
            return

        relative_path = Path(normalized).relative_to("uploads")
        file_path = (self.upload_dir / relative_path).resolve()
        upload_root = self.upload_dir.resolve()
        if not file_path.is_relative_to(upload_root):
            return

        try:
            os.remove(file_path)
        except FileNotFoundError:
            return
        except OSError:
            return

    @staticmethod
    def _has_path_traversal(filename: str) -> bool:
        path = Path(filename)
        return path.is_absolute() or any(part == ".." for part in path.parts)

    @staticmethod
    def _safe_path_segment(value: str, label: str) -> str:
        if not value or value in {".", ".."} or "/" in value or "\\" in value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {label}",
            )
        return value

    @staticmethod
    def _new_target_path(target_dir: Path, suffix: str) -> Path:
        for _ in range(10):
            target_path = target_dir / f"{uuid.uuid4()}{suffix}"
            if not target_path.exists():
                return target_path
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not allocate upload filename",
        )
