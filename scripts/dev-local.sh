#!/usr/bin/env bash
# Runs the whole app locally: creates/updates the tables, the API on :8080 and the site on :5173.
# Reads DATABASE_URL, SESSION_SECRET and any optional keys from .env.local (see .env.local.example).
# Usage: ./scripts/dev-local.sh   then open http://localhost:5173   (Ctrl+C stops both)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "Missing .env.local. Copy .env.local.example to .env.local and fill it in." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.local
set +a

echo "Applying the database schema..."
pnpm --filter @workspace/db run push-force

cleanup() { kill "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

PORT=8080 pnpm --filter @workspace/api-server run dev &
API_PID=$!

PORT=5173 BASE_PATH=/ API_PROXY_TARGET=http://localhost:8080 pnpm --filter @workspace/poker-dashboard run dev &
WEB_PID=$!

echo
echo "  Site: http://localhost:5173   (create an account, then start a club)"
echo "  Dev email inbox (log mode): http://localhost:5173/api/dev/emails"
echo
wait
