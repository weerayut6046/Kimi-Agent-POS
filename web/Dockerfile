# syntax=docker/dockerfile:1

# ── Stage 1: install dependencies (รวม devDeps สำหรับ build) ───────────────
# ใช้ bookworm-slim (glibc) เพราะ better-sqlite3 มี prebuilt binary ให้
# (alpine/musl ไม่มี prebuilt ต้อง compile เอง)
# ต้องเป็น Node 22+: prebuild ของ better-sqlite3 เวอร์ชันใหม่ไม่มีให้ Node 20 (EOL) แล้ว
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# npm ที่ติดมากับ base image อาจมี bug "Exit handler never called"
# ทำให้ npm ci ติดตั้งไม่สมบูรณ์ (ไม่มี node_modules/.bin) — อัปเกรดก่อน
RUN npm install -g npm@11
COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: build frontend (dist/public) + bundle backend (dist/boot.js, dist/seed.js) ──
FROM deps AS build
COPY . .
RUN npm run build

# ── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=/data/pos.db \
    BIND_HOST=0.0.0.0

# เก็บ node_modules ทั้งหมดไว้ เพราะ entrypoint ใช้ drizzle-kit (devDep) migrate ตอน start
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/db ./web/db
COPY package.json ./
COPY web/drizzle.config.ts web/docker-entrypoint.sh ./web/

EXPOSE 3000

ENTRYPOINT ["sh", "./web/docker-entrypoint.sh"]
