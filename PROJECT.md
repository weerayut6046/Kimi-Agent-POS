# Kimi-Agent-POS — เอกสารภาพรวมโครงการ

เอกสารนี้เป็นจุดเริ่มต้นสำหรับผู้พัฒนาและผู้ดูแลระบบ อธิบายสถานะ สถาปัตยกรรม วิธีพัฒนา การสำรองข้อมูล และขั้นตอนปล่อยเวอร์ชันของระบบ POS ปั๊มน้ำมัน

> อัปเดตล่าสุด: 24 กรกฎาคม 2026 — source `2.1.5`; เว็บออนไลน์ย้าย backend และ Auth ไป Supabase ทั้งหมดแล้ว (ดูหัวข้อ 11)

## 1. สถานะปัจจุบัน

| รายการ            | สถานะ                                                               |
| ----------------- | ------------------------------------------------------------------- |
| เวอร์ชันใน source | `2.1.2`                                                             |
| รุ่นเผยแพร่ล่าสุด | `2.1.2`                                                             |
| Branch หลัก       | `main`                                                              |
| รูปแบบใช้งานหลัก  | Windows Desktop (Electron, NSIS installer)                          |
| รูปแบบเสริม       | Portable `.exe`, Web ผ่าน Docker และ Web ออนไลน์ (Vercel + Supabase) |
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
- Supabase Managed Backups เป็นระบบสำรองหลักของ production; การกู้คืนทำผ่าน Supabase Dashboard ตามสิทธิ์ผู้ดูแลโครงการ
- ใช้งานหลายจุดขายผ่าน LAN โดยใช้ฐานข้อมูลและกะร่วมกัน
- Desktop รองรับจอขนาดเล็ก เมนูแบบสไลด์ และการเลื่อนเนื้อหา/dialog ด้วยล้อเมาส์
- UX/UI แบบ Station Console: เมนูแบ่งกลุ่ม สถานะกะชัดเจน ปุ่มเหมาะกับจอสัมผัส และตะกร้า POS แบบ sheet บนมือถือ

## 4. สถาปัตยกรรม

```text
Desktop / Browser
       |
       v
React + TypeScript + Vite + Supabase Auth
       |
       v
Supabase Edge Functions + tRPC API
       |
       v
Drizzle ORM + Supabase PostgreSQL
```

ทุก mutation ที่สำเร็จจะเผยแพร่ opaque invalidation ผ่าน Supabase Realtime private channel จากนั้น client จะ invalidate cache ที่กำลังใช้งานและดึงข้อมูลใหม่ผ่าน tRPC เดิม Event ไม่มี row payload หรือ PII

ในโหมด Desktop, Electron เปิด frontend bundle จาก local HTTP server ในเครื่อง แล้วเรียก Supabase Edge Functions เมื่อออนไลน์ พร้อม cache ข้อมูลอ่านและเก็บคิวบิลออฟไลน์แบบถาวรใน `%APPDATA%/pos-app/desktop-offline-state.json`; เครื่องลูกข่ายไม่มี database secret, service role หรือ `APP_SECRET`

Auto Update แยกจากเส้นทางข้อมูลธุรกิจ: แอป NSIS อ่าน `latest.yml` และดาวน์โหลดตัวติดตั้งจาก Google Cloud Storage ส่วนข้อมูลธุรกิจอยู่บน Supabase

สำหรับเว็บออนไลน์ frontend อยู่บน Vercel และ rewrite `/api/*` ไปยัง Supabase Edge Functions โดยตรง (รายละเอียดหัวข้อ 11)

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
| `supabase/functions/`          | Edge Functions สำหรับ API, AI และการย้ายบัญชีไป Supabase Auth |
| `data/`                        | สำเนา SQLite ต้นทางเดิมสำหรับตรวจสอบ/ย้ายข้อมูลเท่านั้น        |
| `dist/`                        | ผลลัพธ์ build ชั่วคราว ไม่ commit                              |
| `release/`                     | installer, portable, blockmap และ `latest.yml` ไม่ commit      |

## 6. ข้อมูลและการสำรอง

- ตารางแอปอยู่ใน private schema `pos` บน Supabase; RLS เปิดทุกตารางและไม่ให้ `anon/authenticated` เข้าถึงโดยตรง
- API ธุรกิจทุกตัวต้องมี Supabase JWT; bootstrap สำหรับย้าย PIN เดิมปิดถาวรและตอบ `410 MIGRATION_CLOSED`
- API ตรวจสถานะบัญชี บทบาท สิทธิ์รายเมนู และสาขาปัจจุบันฝั่ง server ทุก request
- Realtime ใช้ private channel และ session จาก Supabase Auth; event เป็น opaque invalidation ไม่มี row payload
- Desktop ใช้ frontend bundle ในตัวโปรแกรมและ local sales outbox แต่ไม่เก็บ database secret หรือ `APP_SECRET` ไว้ในเครื่องลูกข่าย
- การเปลี่ยน schema ต้องสร้าง migration และ commit ไฟล์ใน `web/db/migrations-postgres/`
- ห้ามใช้ `db:push` กับ production เพราะอาจทำให้โครงสร้างไม่ตรงกับประวัติ migration
- Supabase Pro Daily Backup เก็บ 7 วันเป็นชั้นหลัก
- Production ใช้ Supabase Managed Backups; แอปไม่รับคำสั่ง `pg_dump`, restore หรือ delete backup
- Restore production ต้องทำผ่าน Supabase Dashboard โดยผู้ดูแลโครงการ และควรทดสอบกับ project แยกก่อนเสมอ

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
| `npm run build:edge`       | bundle API สำหรับ Supabase Edge Functions       |
| `npm run build:desktop`     | build Web/API/Electron                           |
| `npm run dist:exe`          | สร้าง NSIS installer และ Portable ลง `release/`  |
| `npm run publish:gcs`       | อัปโหลดไฟล์เวอร์ชันปัจจุบันไป update bucket      |
| `docker compose up --build` | รัน Web deployment ด้วย Docker                   |
| `npx vercel deploy --prod`  | deploy frontend ขึ้น Vercel (ต้องมี token)       |
| `npx supabase db push`      | apply Supabase migrations (ต้อง link project)    |
| `npx supabase functions deploy pos-api` | deploy backend ขึ้น Supabase Edge |

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

## 11. การ deploy เว็บขึ้นคลาวด์ (Vercel + Supabase)

เว็บ frontend ใช้งานที่ https://kimi-agent-pos.vercel.app และไม่มีบัญชี production เริ่มต้นที่เผยแพร่ใน source

| ส่วน | บริการ | รายละเอียด |
| --- | --- | --- |
| Frontend | Vercel | static build จาก `npx vite build`; `vercel.json` rewrite API ไป Supabase และทำ SPA fallback |
| Backend | Supabase | Edge Functions `pos-api`, `pos-assistant`; `pos-auth-bootstrap` เป็น tombstone ที่ปิดถาวร |
| Auth | Supabase | Email/password identities ที่สร้างจาก username แบบ deterministic; admin เป็นผู้ provision/reset |
| Database | Supabase | PostgreSQL project `Kimi-Agent-POS`; ตารางแอปอยู่ใน private schema `pos` พร้อม RLS |

Vercel เก็บเฉพาะ frontend และ rewrite `/api/*` ไป Supabase Edge Functions ส่วน browser/Desktop ใช้ publishable key และ access token ของผู้ใช้ ไม่ได้รับ service role หรือ database URL

Supabase Edge runtime มี `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` และ `SUPABASE_DB_URL` ให้โดยระบบ ตัวแปร custom ที่ต้องตั้งคือ `APP_ID`, `APP_SECRET`, `SUPABASE_PROJECT_REF` และ `ALLOWED_ORIGINS`

ตัวแปรฝั่ง Vercel ที่ฝังใน frontend คือ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` เท่านั้น ห้ามใส่ `service_role`, database URL, `APP_SECRET` หรือ AI key ในตัวแปรที่ขึ้นต้นด้วย `VITE_`

ผู้ดูแลเลือก provider/model ระหว่าง Ollama/Qwen ภายในเครื่องและ DeepSeek ได้จาก **ตั้งค่าระบบ > AI**; DeepSeek API Key เข้ารหัสใน private table แยกตามสาขาและ browser/Desktop เห็นเพียงสถานะ ไม่เห็น secret ตัวจริง ส่วน environment ใช้เป็น emergency fallback เท่านั้น AI ใช้เลือกเครื่องมือ read-only และผล query ยอดขาย/กะ/สต๊อกที่ละเอียดอ่อนจัดรูปภายใน backend ระบบไม่ส่ง PII/credential/รายละเอียดบิลและไม่บันทึกบทสนทนาลงฐานข้อมูล

ขั้นตอน deploy รอบใหม่:

1. รัน `npm run check`, `npm run lint` และ `npm test`
2. สร้าง Edge bundle ด้วย `npm run build:edge`
3. Apply migration ด้วย `npx supabase db push`
4. Deploy `pos-api` และ `pos-assistant`; `pos-auth-bootstrap` ต้องคงเป็น tombstone ที่ตอบ 410
5. ตรวจ Supabase Auth settings: ปิด signup, password ขั้นต่ำ 10 ตัว, ต้องมีตัวพิมพ์เล็ก/ใหญ่/ตัวเลข, เปิด refresh-token rotation และตั้ง session timeout
6. สร้างหรือรีเซ็ตรหัสพนักงานจากหน้า Workforce/Settings โดย admin; ห้ามเปิด PIN bootstrap กลับมา
7. Deploy frontend ด้วย `npx vercel deploy --prod --yes --token=<VERCEL_TOKEN>`
8. ตรวจ login, สิทธิ์แต่ละบทบาท, เปิดกะ, ขาย, ปิดกะ, Realtime และ logout แบบ end-to-end

Production cutover เสร็จแล้วเมื่อ 24 กรกฎาคม 2026 และ Railway ไม่มี active deployment
บัญชีเดิม 2 บัญชียังต้องให้ admin กำหนดรหัสผ่านใหม่จากหน้า Workforce/Settings
ส่วน Supabase Dashboard ต้องยืนยันการปิด public signup และเปิด Leaked Password
Protection ตาม [`docs/supabase-backend-migration.md`](./docs/supabase-backend-migration.md)

## 12. เอกสารที่เกี่ยวข้อง

- [`README.md`](./README.md) — วิธีเริ่มต้นใช้งานและคำสั่งพื้นฐาน
- [`plan.md`](./plan.md) — แผนและสถานะระบบทั้งหมด
- [`plan-desktop.md`](./plan-desktop.md) — สถาปัตยกรรม Desktop และแผนปล่อยเวอร์ชัน
- [`info.md`](./info.md) — สรุปเทคโนโลยีและตำแหน่งสำคัญสำหรับนักพัฒนา
