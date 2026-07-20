# POS ปั๊มน้ำมัน

เอกสารโครงการ: [`PROJECT.md`](./PROJECT.md) · แผนระบบ: [`plan.md`](./plan.md) · แผน Desktop: [`plan-desktop.md`](./plan-desktop.md)

## Desktop App (Windows .exe)

สร้างไฟล์ติดตั้ง/ไฟล์พกพา:

```bash
npm install
npm run dist:exe   # ออก installer + portable .exe ในโฟลเดอร์ release/
npm run publish:gcs # อัปโหลดไฟล์เวอร์ชันปัจจุบันไป Google Cloud Storage
```

- ครั้งแรกที่เปิดแอป ระบบจะ migrate + seed ข้อมูลตัวอย่างให้อัตโนมัติ
- ข้อมูล SQLite เก็บที่ `%APPDATA%/pos-app/pos.db` — **เปลี่ยนตำแหน่งได้** จากปุ่มบนหน้า Login หรือหน้า Settings (เลือกไฟล์เดิม/สร้างที่ใหม่แล้วแอปรีสตาร์ท)
- **สำรอง/กู้คืนฐานข้อมูล**: หน้า Settings → การ์ด "ฐานข้อมูล" (admin) — สำรองทันที, ดาวน์โหลดไฟล์ .db, กู้คืนจากไฟล์ในเครื่องหรืออัปโหลดจากเครื่องอื่น (ไฟล์สำรองเก็บในโฟลเดอร์ `backups/` ข้างไฟล์ฐานข้อมูล)
- **ขนาดกระดาษใบกำกับภาษี**: หน้า Settings → การพิมพ์เอกสาร → เลือก A4 หรือ A5; พรีวิวและหน้าต่างพิมพ์จะปรับเลย์เอาต์ตามขนาดที่เลือก
- **รองรับจอขนาดเล็ก**: Desktop ปรับขนาดเริ่มต้นตามพื้นที่จอจริง; เมื่อหน้าต่างแคบจะใช้เมนูแบบสไลด์ และเนื้อหา/หน้าต่าง dialog เลื่อนด้วยล้อเมาส์ได้
- **Auto Update**: รุ่น 1.0.18 เป็นต้นไปใช้ `electron-updater` ผ่าน `https://storage.googleapis.com/kimi-agent-pos-updates/`; ผู้สร้าง release ต้อง login `gcloud` ก่อนรัน `npm run publish:gcs`
- พัฒนาแบบ desktop: รัน `npm run dev:desktop` คำสั่งเดียว ระบบจะเปิด Vite และใช้ฐานข้อมูล Desktop ที่ `%APPDATA%/pos-app/pos.db` (หรือตำแหน่งที่เลือกไว้) ให้อัตโนมัติ
- `npm run dev` เป็น web dev แยกต่างหากและใช้ `./data/pos.db`; ถ้ารันพร้อมกัน `dev:desktop` จะเลือกพอร์ตอื่นเพื่อไม่ให้ฐานข้อมูลสลับกัน

## รันด้วย Docker (Web)

ต้องมี Docker / Docker Compose เท่านั้น ไม่ต้องลง Node.js เอง:

```bash
docker compose up --build
```

- เปิดใช้งานที่ http://localhost:3000
- ครั้งแรก container `app` จะ apply migrations (`drizzle-kit migrate`) และ seed ข้อมูลตัวอย่างให้อัตโนมัติ
- บัญชีเริ่มต้นจาก seed: `admin` / PIN `1234` (เจ้าของปั๊ม), `manager` / PIN `2222` (ผู้จัดการสาขา), `somchai` / PIN `0000` (พนักงาน)
- ปรับค่าได้ผ่าน `.env` (ดูตัวอย่างใน `.env.example`) เช่น `APP_SECRET`, `APP_PORT`
- ฐานข้อมูลเป็น SQLite ไฟล์เดียว เก็บใน volume `db_data` — ลบทิ้งทั้งหมดด้วย `docker compose down -v`

## Development (ไม่ใช้ Docker)

```bash
npm install
npm run dev          # dev server ที่ http://localhost:3000 (ฐานข้อมูล ./data/pos.db)
npm run db:migrate   # apply migrations ไปยัง DATABASE_URL
```

## โครงสร้างโปรเจกต์

```
├── web/               # Web app ทั้งก้อน (ใช้ทั้งแบบ browser และฝังใน desktop)
│   ├── src/           # React frontend
│   ├── api/           # Hono + tRPC backend
│   ├── db/            # schema, migrations, seed (Drizzle + SQLite)
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

ใช้ migration files ใน `web/db/migrations/` (commit เข้า git ด้วย) ไม่ใช้ `db:push` อีกต่อไป เพื่อไม่ให้ข้อมูลเดิมเสียหาย:

```bash
# 1. แก้ web/db/schema.ts แล้วสร้าง migration ใหม่
npm run db:generate   # สร้างไฟล์ SQL ใน web/db/migrations/
npm run db:migrate    # apply เข้า DB ที่กำลังใช้งาน
# 2. commit ทั้ง web/db/schema.ts และ web/db/migrations/ — container/แอปจะ migrate เองตอน start
```

## ตรวจคุณภาพก่อน commit/release

```bash
npm run check
npm run lint
npm test
```

ก่อนปล่อย Desktop รุ่นใหม่ให้อ่านขั้นตอนและข้อควรระวังใน [`PROJECT.md`](./PROJECT.md#8-ขั้นตอนปล่อย-desktop-เวอร์ชันใหม่) โดยเฉพาะการเปลี่ยนผ่านจาก GitHub updater รุ่นเก่าไป Google Cloud Storage ในรุ่น `1.0.18`
