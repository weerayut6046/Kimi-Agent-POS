#!/bin/sh
set -e

echo ">> Applying database migrations (drizzle-kit migrate)..."
npx drizzle-kit migrate --config web/drizzle.config.ts

if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo ">> Seeding database (ข้ามอัตโนมัติถ้ามีข้อมูลอยู่แล้ว)..."
  node dist/seed.js
fi

echo ">> Starting server on port ${PORT:-3000}..."
exec node dist/boot.js
