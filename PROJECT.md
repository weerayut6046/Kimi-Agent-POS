# Kimi-Agent-POS — เอกสารภาพรวมโครงการ

เอกสารนี้เป็นจุดเริ่มต้นสำหรับผู้พัฒนาและผู้ดูแลระบบ อธิบายสถานะ สถาปัตยกรรม วิธีพัฒนา การสำรองข้อมูล และขั้นตอนปล่อยเวอร์ชันของระบบ POS ปั๊มน้ำมัน

> อัปเดตล่าสุด: 22 กรกฎาคม 2026 — source/build และรุ่นเผยแพร่ `2.1.2`; เว็บออนไลน์ deploy ที่ Vercel + Railway (ดูหัวข้อ 11)

## 1. สถานะปัจจุบัน

| รายการ            | สถานะ                                                               |
| ----------------- | ------------------------------------------------------------------- |
| เวอร์ชันใน source | `2.1.2`                                                             |
| รุ่นเผยแพร่ล่าสุด | `2.1.2`                                                             |
| Branch หลัก       | `main`                                                              |
| รูปแบบใช้งานหลัก  | Windows Desktop (Electron, NSIS installer)                          |
| รูปแบบเสริม       | Portable `.exe`, Web ผ่าน Docker และ Web ออนไลน์ (Vercel + Railway) |
| ฐานข้อมูล         | Supabase PostgreSQL + Drizzle ORM                                   |
| Auto Update       | Google Cloud Storage ผ่าน `electron-updater` generic provider       |
| Update bucket     | `gs://kimi-agent-pos-updates`                                       |
| การทำงานออฟไลน์   | Desktop ขายเงินสด/QR/บัตรได้ และซิงก์อัตโนมัติเมื่อออนไลน์          |

ไฟล์ติดตั้งรุ่นล่าสุดที่เผยแพร่:

- [POS-Pump-Setup-2.1.2.exe](https://storage.googleapis.com/kimi-agent-pos-updates/POS-Pump-Setup-2.1.2.exe)
- [POS-Pump-Portable-2.1.2.exe](https://storage.googleapis.com/kimi-agent-pos-updates/POS-Pump-Portable-2.1.2.exe)
- [latest.yml](https://storage.googleapis.com/kimi-agent-pos-updates/latest.yml)

รุ่น `1.0.21`–`1.0.24` เพิ่ม Wizard ภาษาไทย, workforce, มิเตอร์ประวัติกะ, แก้ responsive UI และเริ่ม sign executable ด้วย self-signed certificate (`CN=PumpPOS Code Signing`) รุ่น `2.0.0` ย้ายข้อมูลจาก SQLite ขึ้น Supabase PostgreSQL ใน private schema `pos` รุ่น `2.0.1` เพิ่ม Logical Backup ไป Private GCS และลด latency รุ่น `2.0.2` เพิ่ม local desktop runtime, cache และ durable sales outbox ให้เงินสด/QR/บัตรขายต่อได้เมื่ออินเทอร์เน็ตขาด พร้อม idempotent sync ป้องกันข้อมูลซ้ำ รุ่น `2.0.3` ยกเครื่อง UX/UI เป็น Modern Command Center พร้อม Dashboard/POS ใหม่, Quick Menu และ Tank Telemetry แบบเคลื่อนไหว รุ่น `2.0.4` เพิ่มการลากเรียงถังแบบบันทึกถาวร แก้ความแม่นยำลิตรตอนตัดกะเป็น 3 ตำแหน่ง และรองรับรหัสผ่านตัวอักษรบนมือถือ รุ่น `2.0.5` เพิ่ม Auto Update progress/error/retry พร้อมสีของเหลวในถังตามชนิดน้ำมัน รุ่น `2.1.0` เพิ่ม Real-time SSE, กลุ่มสิทธิ์/สิทธิ์รายเมนู และผู้ช่วย AI DeepSeek สำหรับ Admin ที่เข้าถึงข้อมูลผ่าน backend ที่ตรวจสิทธิ์เท่านั้น รุ่น `2.1.1` อัปเดต Hono Node server เพื่อแก้ช่องโหว่ path traversal บน Windows และรุ่น `2.1.2` แก้ audit warning ของ dev/build dependency tree ทั้งหมด

## 2. เป้าหมายและผู้ใช้

ระบบออกแบบสำหรับปั๊มน้ำมันขนาดเล็กถึงกลาง เพื่อให้ทำงานขายหน้าร้าน จัดการกะ ติดตามมิเตอร์และสต็อก ออกเอกสาร และสรุปรายงานได้จากระบบเดียว

บทบาทผู้ใช้มี 3 ระดับ:

- `admin` — ตั้งค่าร้าน จัดการพนักงาน ฐานข้อมูล รายงาน และ Audit log
- `manager` — ดูแลการขาย กะ สต็อก ลูกค้า และรายงานตามสิทธิ์
- `cashier` — เปิดขาย รับชำระ และปฏิบัติงานหน้าร้านตามสิทธิ์

## 3. ความสามารถหลัก

- ขายน้ำมันและสินค้าทั่วไปในบิลเดียว รองรับเงินสด QR บัตร และเครดิต
- เปิด–ปิดกะ บันทึกมิเตอร์ลิตร/เงิน และนับเงินลิ้นชักแยกธนบัตรกับเหรียญ
- จัดการสินค้า ตู้จ่าย หัวจ่าย ถังน้ำมัน การเติมถัง และประวัติราคา
- สมาชิกสะสม/ใช้แต้ม ระดับสมาชิก และแลกของรางวัล
- ลูกค้าเครดิต วงเงิน ยอดค้าง และใบรับชำระหนี้
- เอกสาร A4 สำหรับขอเปิดบัญชีเครดิตและรายการรถบรรทุก/เครื่องจักร โดยดึงข้อมูลลูกค้ามากรอกให้อัตโนมัติ
- ใบเสร็จและใบกำกับภาษีเต็มรูป โดยใบกำกับรองรับ A4 และ A5
- Dashboard, รายงานยอดขาย, Z-report, กำไรต่อลิตร และส่งออก Excel/PDF
- ค่าใช้จ่ายหน้าร้าน การแจ้งเตือนสต็อกต่ำ และ Audit log
- พนักงานและตารางงาน: แม่แบบกะงาน ตารางเวร สลับเวร โปรไฟล์พนักงาน และเงินเดือน (admin จัดการ พนักงานดูข้อมูลตัวเอง)
- admin เพิ่ม/แก้ไข/ลบประวัติตัดกะย้อนหลังพร้อมเลขมิเตอร์รายหัวจ่าย บันทึก Audit log ทุกครั้ง
- Supabase Pro สำรองรายวันย้อนหลัง 7 วัน และ Railway สำรอง schema `pos` ทุก 6 ชั่วโมงไป Private GCS; ดูสถานะ/ดาวน์โหลดจาก Settings และกู้คืนตาม runbook
- ใช้งานหลายจุดขายผ่าน LAN โดยใช้ฐานข้อมูลและกะร่วมกัน
- Desktop รองรับจอขนาดเล็ก เมนูแบบสไลด์ และการเลื่อนเนื้อหา/dialog ด้วยล้อเมาส์
- UX/UI แบบ Station Console: เมนูแบ่งกลุ่ม สถานะกะชัดเจน ปุ่มเหมาะกับจอสัมผัส และตะกร้า POS แบบ sheet บนมือถือ

## 4. สถาปัตยกรรม

```text
Desktop / Browser
       |
       v
React + TypeScript + Vite
       |
       v
Hono + tRPC API
       |
       v
Drizzle ORM + Supabase PostgreSQL
```

ทุก mutation ที่สำเร็จจะเผยแพร่ opaque invalidation ผ่าน PostgreSQL `LISTEN/NOTIFY` ไปยัง authenticated SSE `/api/realtime` จากนั้น client จะ invalidate cache ที่กำลังใช้งานและดึงข้อมูลใหม่ผ่าน tRPC เดิม Event ไม่มี row payload หรือ PII และไม่มี Supabase credential ใน browser; polling เดิมยังคงเป็น safety net ระหว่างที่ stream reconnect

ในโหมด Desktop, Electron เปิด frontend bundle จาก local HTTP server ในเครื่อง แล้ว proxy API ไป Railway เมื่อออนไลน์ พร้อม cache ข้อมูลอ่านและเก็บคิวบิลออฟไลน์แบบถาวรใน `%APPDATA%/pos-app/desktop-offline-state.json`; เครื่องลูกข่ายไม่มี database secret หรือ `APP_SECRET`

Auto Update แยกจากเส้นทางข้อมูลธุรกิจ: แอป NSIS อ่าน `latest.yml` และดาวน์โหลดตัวติดตั้งจาก Google Cloud Storage ส่วนข้อมูลธุรกิจอยู่บน Supabase

สำหรับเว็บออนไลน์ deploy แบบแยกสองชั้น: frontend อยู่บน Vercel และ rewrite `/api/*` ไปยัง backend บน Railway ซึ่งเชื่อม Supabase PostgreSQL ผ่าน connection pooler (รายละเอียดหัวข้อ 11)

## 5. โครงสร้างโครงการ

| ตำแหน่ง                        | หน้าที่                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `web/src/`                     | React UI, pages, components และ client utilities               |
| `web/api/`                     | Hono boot process และ tRPC routers                             |
| `web/db/`                      | PostgreSQL schema, migrations และ seed                         |
| `web/contracts/`               | types และ validation ที่ใช้ร่วมกัน                             |
| `desktop/electron/`            | Electron main process, preload และ updater                     |
| `desktop/scripts/`             | สคริปต์พัฒนา แพ็ก `.exe` และเผยแพร่ GCS                        |
| `desktop/build/`               | EULA, NSIS hooks, โลโก้ ไอคอน และภาพประกอบตัวติดตั้ง           |
| `desktop/electron-builder.yml` | การตั้งค่า NSIS, Portable และ update provider                  |
| `vercel.json`                  | config Vercel — build frontend, rewrite `/api/*`, SPA fallback |
| `railway.toml`                 | config Railway — ชี้ build backend ด้วย `web/Dockerfile`       |
| `data/`                        | สำเนา SQLite ต้นทางเดิมสำหรับตรวจสอบ/ย้ายข้อมูลเท่านั้น        |
| `dist/`                        | ผลลัพธ์ build ชั่วคราว ไม่ commit                              |
| `release/`                     | installer, portable, blockmap และ `latest.yml` ไม่ commit      |

## 6. ข้อมูลและการสำรอง

- ตารางแอปอยู่ใน private schema `pos` บน Supabase; RLS เปิดทุกตารางและไม่ให้ `anon/authenticated` เข้าถึงโดยตรง
- API ธุรกิจทุกตัวต้องมี signed staff session; public ก่อน login มีเพียง login, session check, health check และ LAN discovery ที่ถูกปิดบน production
- Real-time stream ตรวจทั้งลายเซ็นและสถานะบัญชีปัจจุบัน จำกัด connection ต่อบัญชี ส่งเฉพาะ opaque invalidation และหมดอายุตาม session
- `DATABASE_URL` ของ Railway ต้องเป็น Supavisor session mode (`:5432`) เพื่อรองรับ persistent `LISTEN`; ห้ามใช้ transaction mode (`:6543`) สำหรับ realtime listener
- Desktop ใช้ frontend bundle ในตัวโปรแกรมและ local sales outbox แต่ไม่เก็บ database secret หรือ `APP_SECRET` ไว้ในเครื่องลูกข่าย
- การเปลี่ยน schema ต้องสร้าง migration และ commit ไฟล์ใน `web/db/migrations-postgres/`
- ห้ามใช้ `db:push` กับ production เพราะอาจทำให้โครงสร้างไม่ตรงกับประวัติ migration
- Supabase Pro Daily Backup เก็บ 7 วันเป็นชั้นหลัก
- Railway ใช้ `pg_dump 17` สำรอง schema `pos` ทุก 6 ชั่วโมงไป Private GCS ที่ Tokyo; ชุดปกติเก็บ 35 วันและชุดรายเดือน 370 วัน
- หน้า Settings สำหรับ admin แสดงสถานะ ประวัติ SHA-256 สั่งสำรองทันที และสร้าง signed URL ดาวน์โหลด 15 นาที
- ไม่อนุญาต Restore ทับ production จากแอป; Restore ต้องผ่านฐานทดสอบ ส่วน Delete เปิดเฉพาะ Manual Backup พร้อมยืนยันชื่อไฟล์และ GCS Soft Delete ตาม [`docs/database-backup-restore.md`](./docs/database-backup-restore.md)

## 7. คำสั่งสำคัญ

| คำสั่ง                      | ใช้สำหรับ                                        |
| --------------------------- | ------------------------------------------------ |
| `npm install`               | ติดตั้ง dependencies                             |
| `npm run dev`               | พัฒนา Web โดยใช้ Supabase จาก `DATABASE_URL`     |
| `npm run dev:desktop`       | พัฒนา Desktop โดยใช้ Supabase ฐานเดียวกับเว็บ    |
| `npm run db:migrate`        | รัน migration ผ่าน `DIRECT_URL` (session pooler) |
| `npm run check`             | ตรวจ TypeScript                                  |
| `npm run lint`              | ตรวจรูปแบบและกฎ ESLint                           |
| `npm test`                  | รัน Vitest                                       |
| `npm run build:desktop`     | build Web/API/Electron                           |
| `npm run dist:exe`          | สร้าง NSIS installer และ Portable ลง `release/`  |
| `npm run publish:gcs`       | อัปโหลดไฟล์เวอร์ชันปัจจุบันไป update bucket      |
| `docker compose up --build` | รัน Web deployment ด้วย Docker                   |
| `npx vercel deploy --prod`  | deploy frontend ขึ้น Vercel (ต้องมี token)       |
| `npx @railway/cli up`       | deploy backend ขึ้น Railway (ต้องมี token)       |

## 8. ขั้นตอนปล่อย Desktop เวอร์ชันใหม่

1. ปรับ `version` ใน `package.json` และ `package-lock.json`
2. รัน `npm run check`, `npm run lint` และ `npm test`
3. รัน `npm run dist:exe`
4. ตรวจ `release/latest.yml` และ `release/win-unpacked/resources/app-update.yml`
5. login Google Cloud CLI และตรวจว่า project เป็น `kimi-agent-pos`
6. รัน `npm run publish:gcs`
7. ตรวจ URL สาธารณะของ `latest.yml`, installer, Portable และ blockmap
8. Commit และ push source code; สร้าง tag เมื่อประกาศเป็น release อย่างเป็นทางการ
9. ทดสอบอัปเดตจากเวอร์ชันก่อนหน้าบนเครื่องทดสอบหนึ่งเครื่องก่อนกระจายหน้างาน

ข้อควรระวังในการย้ายระบบอัปเดต:

- รุ่น `1.0.17` และเก่ากว่ายังมี GitHub provider ฝังอยู่ จึงไม่เห็นไฟล์อัปเดตบน GCS โดยอัตโนมัติ
- ต้องติดตั้ง `1.0.18` ด้วยมือหนึ่งครั้ง หรือเผยแพร่ `1.0.18` บน GitHub เป็น bridge release
- หลังอยู่บน `1.0.18` แล้ว รุ่นถัดไปจะตรวจอัปเดตจาก GCS
- Portable `.exe` ไม่สามารถแทนที่ตัวเองอัตโนมัติ ผู้ใช้ต้องดาวน์โหลดไฟล์ Portable รุ่นใหม่

## 9. เกณฑ์คุณภาพก่อนส่งมอบ

- `npm run check`, `npm run lint` และ `npm test` ต้องผ่าน
- รุ่น `1.0.20` ตรวจผ่าน 14 test files รวม 89 tests
- ทดสอบเส้นทางหลัก: Login → เปิดกะ → ขาย → พิมพ์ → ปิดกะ → รายงาน
- ทดสอบหน้า Settings หลังเข้าเมนูครั้งแรก สลับเมนู และบันทึกค่าใหม่
- ทดสอบพิมพ์ใบกำกับทั้ง A4/A5 และใบเสร็จตามขนาดที่ตั้ง
- ทดสอบหน้าต่างบนจอขนาดเล็กและ dialog ที่มีเนื้อหายาว
- ทดสอบสำรองและกู้คืนด้วยสำเนาฐานข้อมูล ไม่ใช้ฐานข้อมูลจริงเพียงชุดเดียว
- ทดสอบ Auto Update จากเวอร์ชันก่อนหน้าไปยังเวอร์ชันใหม่

## 10. Roadmap ที่ยังเหลือ

ลำดับเร่งด่วน:

- [ ] ทดสอบ NSIS installer และการใช้งานข้ามวันบนเครื่องปั๊มจริง
- [ ] ทดสอบ Auto Update จาก `1.0.20` ไปเวอร์ชันถัดไปแบบ end-to-end
- [ ] จัดทำคู่มือพนักงานและคู่มือผู้ดูแลระบบ
- [x] เพิ่ม Code Signing เพื่อลดคำเตือน Windows SmartScreen — ทำแล้วใน `1.0.24` แบบ self-signed (ครอบคลุม Smart App Control เมื่อเครื่องปลายทาง import root cert); ถ้าจะแจกจ่ายกว้างค่อยอัปเกรดเป็น OV/EV certificate

งานต่อยอด:

- [ ] เชื่อมตู้จ่าย/มิเตอร์จริงเมื่อมีฮาร์ดแวร์และ protocol ที่รองรับ
- [ ] รองรับหลายสาขาและการซิงก์ข้อมูลขึ้นคลาวด์
- [ ] พิจารณา e-Tax Invoice และการเชื่อมระบบบัญชี

## 11. การ deploy เว็บขึ้นคลาวด์ (Vercel + Railway)

เว็บออนไลน์ใช้งานได้ที่ https://kimi-agent-pos.vercel.app (บัญชีเริ่มต้นตาม seed: `admin`/`1234`, `manager`/`2222`, `somchai`/`0000` — ควรเปลี่ยน PIN ทันที)

| ส่วน     | บริการ   | รายละเอียด                                                                                                                    |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Vercel   | project `kimi-agent-pos` — static build จาก `npx vite build` ลง `dist/public`; `vercel.json` ตั้ง rewrite และ SPA fallback    |
| Backend  | Railway  | project `pos-pump-api` service `api` ที่ `api-production-dc37.up.railway.app` — build จาก `web/Dockerfile` ตาม `railway.toml` |
| Database | Supabase | PostgreSQL project `Kimi-Agent-POS`; ตารางแอปอยู่ใน private schema `pos` พร้อม RLS                                            |

Vercel เก็บ frontend และ rewrite `/api/*` ไป Railway ส่วน Railway เป็น backend ที่ถือ Supabase connection secret; browser และ Desktop ไม่เชื่อมฐานข้อมูลโดยตรง

ตัวแปรแวดล้อมบน Railway: `APP_ID`, `APP_SECRET` (สุ่มตอน deploy), `DATABASE_URL` (Supabase session pooler สำหรับ backend แบบ long-lived), `DATABASE_POOL_SIZE=5`, `DEEPSEEK_API_KEY` (server-only), `DEEPSEEK_MODEL=deepseek-v4-flash`, `SEED_ON_START=false`

ตัวแปรแวดล้อมฝั่ง Vercel ที่ถูกฝังใน frontend สำหรับ Supabase Realtime: `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` (ใช้ publishable key เท่านั้น; ห้ามใช้ `service_role`/secret key หรือ DeepSeek key)

ผู้ช่วย AI ใช้ gateway ฝั่ง Railway เรียก DeepSeek Chat Completions โดย browser/Desktop ไม่เห็น API key; DeepSeek ใช้เลือกเครื่องมือ read-only เท่านั้น ส่วนผล query ยอดขาย/กะ/สต๊อกจัดรูปภายใน backend และไม่ส่งกลับไปยัง DeepSeek ระบบไม่ส่ง PII/credential/รายละเอียดบิลและไม่บันทึกบทสนทนาลงฐานข้อมูล

ขั้นตอน deploy รอบใหม่ (ทำจาก root ของ repo ต้องมี token ของแต่ละบริการ):

1. แก้โค้ดแล้วรัน `npm run check`, `npm run lint`, `npm test`
2. Frontend: `npx vercel deploy --prod --yes --token=<VERCEL_TOKEN>` (โฟลเดอร์ link กับ project ไว้แล้วใน `.vercel/`)
3. Backend: `RAILWAY_TOKEN=<PROJECT_TOKEN> npx @railway/cli up --service api --environment production`
4. ตรวจว่า `curl https://kimi-agent-pos.vercel.app/` ตอบ 200 และ `POST /api/trpc/auth.login` ตอบ JSON (ไม่ใช่ 502)

หมายเหตุ: ถ้าเปลี่ยนโดเมน backend ให้แก้ `destination` ของ rewrite `/api/:path*` ใน `vercel.json` แล้ว redeploy frontend

## 12. เอกสารที่เกี่ยวข้อง

- [`README.md`](./README.md) — วิธีเริ่มต้นใช้งานและคำสั่งพื้นฐาน
- [`plan.md`](./plan.md) — แผนและสถานะระบบทั้งหมด
- [`plan-desktop.md`](./plan-desktop.md) — สถาปัตยกรรม Desktop และแผนปล่อยเวอร์ชัน
- [`info.md`](./info.md) — สรุปเทคโนโลยีและตำแหน่งสำคัญสำหรับนักพัฒนา
