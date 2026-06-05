#!/bin/bash

WORK_DIR="$HOME/erp-pos-run"

echo "🛑 Stopping ERP-POS..."

if [ -f "$WORK_DIR/docker-compose.yml" ]; then
  cd "$WORK_DIR" && docker compose down
  echo "✅ ERP-POS stopped."
else
  # Fallback: stop by port
  for PORT in 80 8000 5432 6379; do
    CONTAINER=$(docker ps --format '{{.ID}} {{.Ports}}' \
      | grep ":${PORT}->" | awk '{print $1}' | head -1)
    if [ -n "$CONTAINER" ]; then
      docker stop "$CONTAINER" > /dev/null 2>&1 && \
        echo "   Stopped container on port $PORT"
    fi
  done
  echo "✅ Done."
fi
