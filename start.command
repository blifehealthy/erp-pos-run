#!/bin/bash
set -e

PROJECT_DIR='/Users/macbook/Library/CloudStorage/GoogleDrive-chaiyanut.og@gmail.com/My Drive/ERP-POS System/erp-pos'
WORK_DIR="$HOME/erp-pos-run"

echo "================================================"
echo "  ERP-POS System — Starting..."
echo "================================================"

# ── Step 1: Check Docker is running ──────────────
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Opening Docker Desktop..."
  open -a "Docker"
  echo "⏳ Waiting for Docker to start (up to 60s)..."
  for i in {1..30}; do
    sleep 2
    if docker info > /dev/null 2>&1; then
      echo "✅ Docker is ready."
      break
    fi
    if [ $i -eq 30 ]; then
      echo "❌ Docker did not start in time. Please open Docker Desktop manually."
      exit 1
    fi
  done
fi

# ── Step 2: Stop ANY existing ERP-POS containers ─
echo "🧹 Cleaning up existing ERP-POS containers..."

# Stop containers using our ports (80, 8000, 5432, 6379)
for PORT in 80 8000 5432 6379; do
  CONTAINER=$(docker ps --format '{{.ID}} {{.Ports}}' | grep ":${PORT}->" | awk '{print $1}' | head -1)
  if [ -n "$CONTAINER" ]; then
    echo "   Stopping container using port $PORT: $CONTAINER"
    docker stop "$CONTAINER" > /dev/null 2>&1 || true
  fi
done

# Also stop by compose project name (erp-pos or erp-pos-run)
for PROJECT in "erp-pos" "erp-pos-run"; do
  if docker compose -p "$PROJECT" ps -q 2>/dev/null | grep -q .; then
    echo "   Stopping compose project: $PROJECT"
    docker compose -p "$PROJECT" down --remove-orphans > /dev/null 2>&1 || true
  fi
done

# Stop any leftover containers in WORK_DIR
if [ -f "$WORK_DIR/docker-compose.yml" ]; then
  echo "   Stopping previous work dir stack..."
  cd "$WORK_DIR" && docker compose down --remove-orphans > /dev/null 2>&1 || true
fi

echo "✅ Cleanup done."

# ── Step 3: Copy project from Google Drive ───────
echo "📁 Copying project to $WORK_DIR ..."
rm -rf "$WORK_DIR"
cp -r "$PROJECT_DIR" "$WORK_DIR"
cd "$WORK_DIR"

# ── Step 4: Setup .env ───────────────────────────
if [ ! -f .env ]; then
  echo "⚙️  Creating .env from example..."
  cp .env.example .env
fi

# ── Step 5: Verify ports are now free ────────────
echo "🔍 Checking ports..."
BUSY_PORTS=""
for PORT in 80 8000; do
  if lsof -i ":$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
    BUSY_PORTS="$BUSY_PORTS $PORT"
  fi
done
if [ -n "$BUSY_PORTS" ]; then
  echo "⚠️  Ports still busy:$BUSY_PORTS"
  echo "   Another application (not Docker) is using these ports."
  echo "   Please free them and try again, or change ports in docker-compose.yml"
  exit 1
fi

# ── Step 6: Build and start ──────────────────────
echo "🐳 Building and starting containers..."
docker compose up --build -d

# ── Step 7: Run migrations before health check ──
echo "🗄️  Running database migrations..."
docker compose run --rm backend alembic upgrade heads

# ── Step 8: Wait for health check ────────────────
echo "⏳ Waiting for services to be ready..."
READY=false
for i in {1..45}; do
  if curl -s http://localhost/health 2>/dev/null | grep -q '"ok"'; then
    READY=true
    break
  fi
  printf "."
  sleep 2
done
echo ""

if [ "$READY" = false ]; then
  echo "⚠️  Services took too long. Checking logs..."
  docker compose logs --tail=20 backend
  echo ""
  echo "Try: docker compose logs -f"
  exit 1
fi

# ── Done ─────────────────────────────────────────
echo ""
echo "================================================"
echo "  ✅ ERP-POS is ready!"
echo "  🌐 URL:      http://localhost"
echo "  👤 Username: admin"
echo "  🔑 Password: Admin1234!"
echo "  🏢 Company:  9790f996-1078-4634-9876-c5a828cbb263"
echo "================================================"
echo ""

# Auto-open browser (Mac)
sleep 1
open http://localhost 2>/dev/null || \
  xdg-open http://localhost 2>/dev/null || \
  echo "Please open http://localhost in your browser."
