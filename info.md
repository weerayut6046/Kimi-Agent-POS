# ข้อมูลสำหรับนักพัฒนา Kimi-Agent-POS

> อัปเดตล่าสุด: 20 กรกฎาคม 2026 — source/build ในเครื่อง `1.0.22`; รุ่นเผยแพร่ `1.0.22`; เว็บออนไลน์ https://kimi-agent-pos.vercel.app (Vercel + Railway)

## Technology stack

- Node.js 20+
- React 19 + TypeScript 5.9 + Vite 7
- Tailwind CSS 3.4 + shadcn/ui/Radix UI
- Hono + tRPC + Zod
- SQLite + Drizzle ORM + better-sqlite3
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
- `vercel.json` / `railway.toml` — config deploy เว็บออนไลน์ (frontend บน Vercel, backend บน Railway)
- `release/` — ผลลัพธ์ installer/Portable ไม่ commit เข้า Git

## เอกสารหลัก

- [`PROJECT.md`](./PROJECT.md) — ภาพรวม สถาปัตยกรรม และ release workflow
- [`README.md`](./README.md) — วิธีติดตั้งและเริ่มพัฒนา
- [`plan.md`](./plan.md) — แผนระบบทั้งหมด
- [`plan-desktop.md`](./plan-desktop.md) — แผน Desktop และ Auto Update

## กฎสำคัญ

- เปลี่ยน schema ด้วย migration ใน `web/db/migrations/`; ห้ามใช้ `db:push` กับฐานข้อมูลหน้างาน
- ก่อนปล่อยเวอร์ชันให้รัน `npm run check`, `npm run lint` และ `npm test`
- Build Desktop ด้วย `npm run dist:exe`
- NSIS installer ใช้โหมด per-machine จึงติดตั้งใน `Program Files` สำหรับทุกผู้ใช้และต้องยืนยันสิทธิ์ Administrator
- รุ่น `1.0.18` เป็นต้นไปเผยแพร่ Auto Update ด้วย `npm run publish:gcs`
- อย่า commit ไฟล์ฐานข้อมูล, secrets, `dist/` หรือ `release/`
