#!/bin/sh
set -e

DB_URL="${EXTERNAL_DATABASE_URL:-$DATABASE_URL}"

if [ -z "$DB_URL" ]; then
  echo "[ENTRYPOINT][FATAL] Neither EXTERNAL_DATABASE_URL nor DATABASE_URL is set."
  exit 1
fi

echo "[ENTRYPOINT] Starting Cronos Fichajes on port ${PORT:-3000}..."

exec node dist/index.cjs
