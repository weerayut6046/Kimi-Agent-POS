#!/bin/sh
set -e

if [ -z "${DATABASE_URL:-}" ]; then
  echo ">> DATABASE_URL is required (use the Supabase session pooler URL for this persistent backend)" >&2
  exit 1
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
  echo ">> Seeding database (ข้ามอัตโนมัติถ้ามีข้อมูลอยู่แล้ว)..."
  node dist/seed.js
fi

echo ">> Starting server on port ${PORT:-3000}..."
exec node dist/boot.js
