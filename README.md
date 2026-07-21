# POS ปั๊มน้ำมัน

เอกสารโครงการ: [`PROJECT.md`](./PROJECT.md) · แผนระบบ: [`plan.md`](./plan.md) · แผน Desktop: [`plan-desktop.md`](./plan-desktop.md)

## Desktop App (Windows .exe)

สร้างไฟล์ติดตั้ง/ไฟล์พกพา:

```bash
npm install
npm run build:installer-assets # สร้างภาพ/ไอคอน NSIS ใหม่เมื่อเปลี่ยนโลโก้หรือพื้นหลัง
npm run dist:exe   # ออก installer + portable .exe ในโฟลเดอร์ release/
npm run publish:gcs # อัปโหลดไฟล์เวอร์ชันปัจจุบันไป Google Cloud Storage
```

- แอป Desktop ใช้ frontend bundle ในเครื่องและฐานข้อมูล Supabase เดียวกับเว็บ; เมื่ออินเทอร์เน็ตขาดยังขายเงินสด/QR/บัตรได้ บิลจะเก็บในเครื่องและซิงก์อัตโนมัติเมื่อออนไลน์
- **รุ่น 2.0.3**: ยกเครื่อง UX/UI เป็น Modern Command Center ทั้ง navigation, Login, Dashboard และ POS; เพิ่ม Quick Menu, motion/interaction, responsive mobile dock และ Tank Telemetry รูปถังพร้อมระดับน้ำมันเคลื่อนไหวตามข้อมูลจริง
- **รุ่น 2.0.2**: เพิ่ม Offline-first sales, แถบสถานะ/จำนวนบิลรอซิงก์, durable outbox และ idempotent API ป้องกันบิล สต๊อก และแต้มซ้ำ; ขายเชื่อ ใช้แต้ม และใบกำกับภาษีเต็มรูปต้องออนไลน์
- **รุ่น 2.0.1**: เพิ่ม Logical Backup ไป Private GCS, แสดงสถานะ/ดาวน์โหลด Backup ใน Settings และลด latency ด้วย Railway Singapore, Dashboard query แบบขนาน และ bulk upsert สำหรับ Settings
- **รุ่น 2.0.0**: ย้าย schema/ข้อมูลเดิมขึ้น Supabase PostgreSQL, ใช้ backend Railway + frontend Vercel, signed staff session และแก้ Dashboard โหลดค้างด้วย session pooler/แยก tRPC request
- **ตัวติดตั้งภาษาไทย**: ใช้ Wizard แบบทีละขั้น (ยินดีต้อนรับ → ข้อตกลง → เลือกโฟลเดอร์ → พร้อมติดตั้ง) พร้อมโลโก้ KY; ติดตั้งสำหรับผู้ใช้ทุกคนใน `Program Files` และขอสิทธิ์ผู้ดูแลระบบ
- ข้อมูลอยู่ใน Supabase PostgreSQL และสำรองสองชั้น: Supabase Pro Daily Backup 7 วัน + Logical Backup ทุก 6 ชั่วโมงไป Private GCS (35 วัน/รายเดือน 370 วัน); หน้า Settings รองรับ Restore ผ่านฐานทดสอบและลบเฉพาะ Manual Backup ที่ยืนยันชื่อไฟล์ตาม [`docs/database-backup-restore.md`](./docs/database-backup-restore.md)
- **ขนาดกระดาษใบกำกับภาษี**: หน้า Settings → การพิมพ์เอกสาร → เลือก A4 หรือ A5; พรีวิวและหน้าต่างพิมพ์จะปรับเลย์เอาต์ตามขนาดที่เลือก
- **รองรับจอขนาดเล็ก**: Desktop ปรับขนาดเริ่มต้นตามพื้นที่จอจริง; เมื่อหน้าต่างแคบจะใช้เมนูแบบสไลด์ และเนื้อหา/หน้าต่าง dialog เลื่อนด้วยล้อเมาส์ได้
- **UX/UI รุ่น 1.0.20**: ปรับเป็น Station Console แบ่งเมนูตามงาน แสดงสถานะกะ ปุ่ม/ช่องกรอกเหมาะกับจอสัมผัส และใช้ตะกร้าแบบ sheet บนมือถือ
- **เอกสารลูกค้าเครดิต**: เมนูเอกสารสำหรับพิมพ์ใบขอเปิดบัญชีเครดิตและรายการรถบรรทุก/เครื่องจักร A4 (admin/manager)
- **Auto Update**: รุ่น 1.0.18 เป็นต้นไปใช้ `electron-updater` ผ่าน `https://storage.googleapis.com/kimi-agent-pos-updates/`; ผู้สร้าง release ต้อง login `gcloud` ก่อนรัน `npm run publish:gcs`
- **Code Signing (1.0.24+)**: ทุก executable sign ด้วย self-signed cert (`CN=PumpPOS Code Signing`) อัตโนมัติตอน build ถ้ามี `desktop/certs/pumpos-codesign.pfx` — เครื่องปลายทางต้องรัน `certs/install-pos-root-cert.bat` (แนบในตัวติดตั้ง) ด้วยสิทธิ์ Administrator ครั้งเดียว เพื่อให้ Smart App Control/SmartScreen ยอมรับแอป
- พัฒนาแบบ desktop: ตั้ง `DATABASE_URL` เป็น Supabase pooler URL แล้วรัน `npm run dev:desktop`

## รันด้วย Docker (Web)

กำหนด `DATABASE_URL` และ `APP_SECRET` ใน `.env` แล้วรัน:

```bash
docker compose up --build
```

- เปิดใช้งานที่ http://localhost:3000
- Container แบบ long-lived เชื่อม Supabase PostgreSQL ผ่าน session pooler; migration schema ทำแบบส่วนกลางก่อน deploy
- ปรับค่าได้ผ่าน `.env` เช่น `DATABASE_URL`, `DATABASE_POOL_SIZE`, `APP_SECRET`, `APP_PORT`

## Deploy เว็บขึ้นคลาวด์ (Vercel + Railway)

ระบบ deploy ออนไลน์ไว้ที่ https://kimi-agent-pos.vercel.app

- **Frontend** — static build บน Vercel (project `kimi-agent-pos`); `vercel.json` กำหนด build เฉพาะ frontend (`npx vite build` → `dist/public`), rewrite `/api/*` ไป backend และ SPA fallback ทุก route กลับ `index.html`
- **Backend** — Docker container บน Railway (project `pos-pump-api`, service `api`) ที่ `https://api-production-dc37.up.railway.app`; เชื่อม Supabase PostgreSQL ผ่าน session pooler
- **Database** — Supabase project `Kimi-Agent-POS`, private schema `pos` (RLS เปิดทุกตารางและไม่เปิดให้ Data API)
- ตัวแปรบน Railway: `APP_ID`, `APP_SECRET`, `DATABASE_URL`, `DATABASE_POOL_SIZE=5`, `SEED_ON_START=false`
- บัญชีเริ่มต้นเหมือนชุด seed ของ Docker — **เปลี่ยน PIN ทันทีหลังเข้าใช้ครั้งแรก**

deploy รอบใหม่ (ต้องมี token ของแต่ละบริการ):

```bash
npx vercel deploy --prod   # frontend — อัปโหลดเวอร์ชันไฟล์ local ตาม .vercel/ ที่ link ไว้
npx @railway/cli up        # backend — build จาก web/Dockerfile บน Railway
```

## Development (ไม่ใช้ Docker)

```bash
npm install
npm run dev          # dev server ที่ http://localhost:3000 (ต้องตั้ง DATABASE_URL)
npm run db:migrate   # apply migrations ไปยัง DIRECT_URL (fallback: DATABASE_URL)
```

## โครงสร้างโปรเจกต์

```
├── web/               # Web app ทั้งก้อน (ใช้ทั้งแบบ browser และฝังใน desktop)
│   ├── src/           # React frontend
│   ├── api/           # Hono + tRPC backend
│   ├── db/            # schema, migrations, seed (Drizzle + PostgreSQL)
│   ├── contracts/     # types/errors ที่แชร์กัน
│   ├── index.html
│   ├── drizzle.config.ts
│   └── Dockerfile, docker-entrypoint.sh
├── desktop/           # Desktop App (Electron)
│   ├── electron/      # main process
│   ├── scripts/       # dev launcher, pack-exe.mjs และ publish-gcs.mjs
│   └── electron-builder.yml
├── PROJECT.md         # ภาพรวมโครงการ สถาปัตยกรรม และ release workflow
├── plan.md            # แผนระบบทั้งหมด
├── plan-desktop.md    # แผนเฉพาะ Desktop
├── dist/              # build outputs (ไม่ commit)
└── release/           # .exe outputs (ไม่ commit)
```

## เปลี่ยนโครงสร้างฐานข้อมูล (schema)

ใช้ migration files ใน `web/db/migrations-postgres/` (commit เข้า git ด้วย) ไม่ใช้ `db:push` กับ production:

```bash
# 1. แก้ web/db/schema.ts แล้วสร้าง migration ใหม่
npm run db:generate   # สร้างไฟล์ SQL ใน web/db/migrations-postgres/
# 2. ตั้ง DIRECT_URL เป็น Supabase session pooler (:5432) แล้วตรวจ/apply migration ก่อน deploy backend
# 3. commit ทั้ง schema และ migration
```

## ตรวจคุณภาพก่อน commit/release

```bash
npm run check
npm run lint
npm test
```

ก่อนปล่อย Desktop รุ่นใหม่ให้อ่านขั้นตอนและข้อควรระวังใน [`PROJECT.md`](./PROJECT.md#8-ขั้นตอนปล่อย-desktop-เวอร์ชันใหม่) โดยเฉพาะการเปลี่ยนผ่านจาก GitHub updater รุ่นเก่าไป Google Cloud Storage ในรุ่น `1.0.18`
