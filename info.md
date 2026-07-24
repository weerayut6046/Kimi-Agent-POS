# ข้อมูลสำหรับนักพัฒนา Kimi-Agent-POS

> อัปเดตล่าสุด: 24 กรกฎาคม 2026 — source `2.1.5`; เว็บออนไลน์ใช้ Vercel + Supabase Edge Functions/Auth/PostgreSQL

## Technology stack

- Node.js 20+
- React 19 + TypeScript 5.9 + Vite 7
- Tailwind CSS 3.4 + shadcn/ui/Radix UI
- Hono + tRPC + Zod
- Supabase PostgreSQL + Drizzle ORM + postgres.js
- Electron 42 + electron-builder + electron-updater
- Vitest + ESLint + Prettier

## ตำแหน่งสำคัญ

- `web/src/` — React pages, components, hooks และ client utilities
- `web/api/` — Hono server และ tRPC routers
- `web/db/` — schema, migrations และ seed
- `web/contracts/` — types/validation ที่ใช้ร่วมกัน
- `desktop/electron/` — Electron main process, preload และ updater
- `desktop/scripts/` — dev launcher, packager และ GCS publisher
- `desktop/build/` — NSIS Wizard ภาษาไทย, EULA, ไอคอน และภาพแบรนด์ของตัวติดตั้ง
- `desktop/certs/` — code-signing certificate (commit เฉพาะ `.cer` สาธารณะ; `.pfx` และ password ไม่ commit)
- `vercel.json` / `supabase/functions/` — config frontend และ Supabase Edge Functions
- `release/` — ผลลัพธ์ installer/Portable ไม่ commit เข้า Git

## เอกสารหลัก

- [`PROJECT.md`](./PROJECT.md) — ภาพรวม สถาปัตยกรรม และ release workflow
- [`README.md`](./README.md) — วิธีติดตั้งและเริ่มพัฒนา
- [`plan.md`](./plan.md) — แผนระบบทั้งหมด
- [`plan-desktop.md`](./plan-desktop.md) — แผน Desktop และ Auto Update
- [`docs/database-backup-restore.md`](./docs/database-backup-restore.md) — นโยบาย Backup สองชั้น, การตรวจสอบ และ Restore drill

## กฎสำคัญ

- เปลี่ยน schema ด้วย migration ใน `web/db/migrations-postgres/`; ห้ามใช้ `db:push` กับ production
- ก่อนปล่อยเวอร์ชันให้รัน `npm run check`, `npm run lint` และ `npm test`
- Build Desktop ด้วย `npm run dist:exe`
- NSIS installer ใช้โหมด per-machine จึงติดตั้งใน `Program Files` สำหรับทุกผู้ใช้และต้องยืนยันสิทธิ์ Administrator
- รุ่น `1.0.18` เป็นต้นไปเผยแพร่ Auto Update ด้วย `npm run publish:gcs`
- Production ใช้ Supabase Managed Backups; ห้าม Restore ทับ production จากหน้าแอป
- อย่า commit ไฟล์ฐานข้อมูล, secrets, `dist/` หรือ `release/`
