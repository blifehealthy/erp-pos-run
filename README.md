# ERP-POS

## 1. Project overview

ERP + POS system for Thailand with multi-tenant, multi-branch support, offline-ready POS workflows, and Docker-based deployment for Ubuntu VPS environments.

## 2. Prerequisites

- Docker
- Docker Compose v2
- Node 20+
- Python 3.11+

## 3. Quick start

```bash
cp .env.example .env
docker compose up -d
# visit http://localhost
```

## 4. Development notes

- Backend uses FastAPI, SQLAlchemy async, Alembic, Redis, and Celery.
- Frontend uses React, Vite, Zustand, React Query, Tailwind CSS, Dexie, and Workbox PWA support.
- Nginx proxies the React frontend and FastAPI backend through a single entrypoint.
- Docker development mode mounts the backend and frontend source trees for fast iteration.

## 5. Project structure overview

```text
erp-pos/
├── backend/
├── frontend/
├── nginx/
├── docker-compose.yml
├── docker-compose.prod.yml
└── .env.example
```
