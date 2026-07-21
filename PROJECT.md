# Kimi-Agent-POS — เอกสารภาพรวมโครงการ

เอกสารนี้เป็นจุดเริ่มต้นสำหรับผู้พัฒนาและผู้ดูแลระบบ อธิบายสถานะ สถาปัตยกรรม วิธีพัฒนา การสำรองข้อมูล และขั้นตอนปล่อยเวอร์ชันของระบบ POS ปั๊มน้ำมัน

> อัปเดตล่าสุด: 20 กรกฎาคม 2026 — source/build ในเครื่อง `1.0.22`; รุ่นเผยแพร่บน GCS `1.0.22`; เว็บออนไลน์ deploy ที่ Vercel + Railway (ดูหัวข้อ 11)

## 1. สถานะปัจจุบัน

| รายการ            | สถานะ                                                               |
| ----------------- | ------------------------------------------------------------------- |
| เวอร์ชันใน source | `1.0.22`                                                            |
| รุ่นเผยแพร่ล่าสุด | `1.0.22`                                                            |
| Branch หลัก       | `main`                                                              |
| รูปแบบใช้งานหลัก  | Windows Desktop (Electron, NSIS installer)                          |
| รูปแบบเสริม       | Portable `.exe`, Web ผ่าน Docker และ Web ออนไลน์ (Vercel + Railway) |
| ฐานข้อมูล         | SQLite + Drizzle ORM                                                |
| Auto Update       | Google Cloud Storage ผ่าน `electron-updater` generic provider       |
| Update bucket     | `gs://kimi-agent-pos-updates`                                       |
| การทำงานออฟไลน์   | งานขายและฐานข้อมูลทำงานในเครื่องได้โดยไม่ใช้อินเทอร์เน็ต            |

ไฟล์ติดตั้งรุ่นล่าสุดที่เผยแพร่:

- [POS-Pump-Setup-1.0.22.exe](https://storage.googleapis.com/kimi-agent-pos-updates/POS-Pump-Setup-1.0.22.exe)
- [POS-Pump-Portable-1.0.22.exe](https://storage.googleapis.com/kimi-agent-pos-updates/POS-Pump-Portable-1.0.22.exe)
- [latest.yml](https://storage.googleapis.com/kimi-agent-pos-updates/latest.yml)

รุ่น `1.0.21` เพิ่ม Wizard ภาษาไทยพร้อม EULA/โลโก้ KY ติดตั้งแบบ per-machine ใน `Program Files`, ฟีเจอร์พนักงานและตารางงาน (workforce), admin จัดการประวัติตัดกะ และ config deploy เว็บออนไลน์ ส่วนรุ่น `1.0.22` (เผยแพร่ 20 กรกฎาคม 2026) เพิ่มการบันทึกเลขมิเตอร์เปิด–ปิดรายหัวจ่ายตอนสร้าง/แก้ประวัติตัดกะ พร้อมคำนวณยอดรวมให้อัตโนมัติ — ทุกรุ่นอัปโหลด installer + Portable + blockmap + `latest.yml` ขึ้น GCS แล้ว (ไม่ได้สร้าง git tag เช่นเดียวกับรุ่น `1.0.18` เป็นต้นมา)

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
- สำรอง/กู้คืนฐานข้อมูล พร้อมสำรองอัตโนมัติรายวัน
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
Drizzle ORM + SQLite (better-sqlite3)
```

ในโหมด Desktop, Electron จะ migrate ฐานข้อมูล สตาร์ท Hono server ภายในเครื่องที่ `127.0.0.1:3210` และเปิด React UI ใน `BrowserWindow` ส่วนโหมด LAN จะเปิดให้เครื่องลูกเข้าถึง server เดียวกันเมื่อผู้ดูแลเปิดใช้งาน

Auto Update แยกจากเส้นทางข้อมูลธุรกิจ: แอป NSIS จะอ่าน `latest.yml` และดาวน์โหลดตัวติดตั้งจาก Google Cloud Storage ส่วนฐานข้อมูลยังอยู่ในเครื่องของร้าน

สำหรับเว็บออนไลน์ deploy แบบแยกสองชั้น: frontend (static build จาก Vite) อยู่บน Vercel และ rewrite `/api/*` ไปยัง backend (Docker container จาก `web/Dockerfile`) ที่รันบน Railway พร้อม volume `/data` เก็บไฟล์ SQLite ถาวร — ไม่ใช้ Vercel serverless เพราะ backend ผูกกับ `better-sqlite3` และระบบไฟล์ถาวร (รายละเอียดหัวข้อ 11)

## 5. โครงสร้างโครงการ

| ตำแหน่ง                        | หน้าที่                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `web/src/`                     | React UI, pages, components และ client utilities               |
| `web/api/`                     | Hono boot process และ tRPC routers                             |
| `web/db/`                      | SQLite schema, migrations และ seed                             |
| `web/contracts/`               | types และ validation ที่ใช้ร่วมกัน                             |
| `desktop/electron/`            | Electron main process, preload และ updater                     |
| `desktop/scripts/`             | สคริปต์พัฒนา แพ็ก `.exe` และเผยแพร่ GCS                        |
| `desktop/build/`               | EULA, NSIS hooks, โลโก้ ไอคอน และภาพประกอบตัวติดตั้ง           |
| `desktop/electron-builder.yml` | การตั้งค่า NSIS, Portable และ update provider                  |
| `vercel.json`                  | config Vercel — build frontend, rewrite `/api/*`, SPA fallback |
| `railway.toml`                 | config Railway — ชี้ build backend ด้วย `web/Dockerfile`       |
| `data/`                        | ฐานข้อมูลสำหรับ Web development                                |
| `dist/`                        | ผลลัพธ์ build ชั่วคราว ไม่ commit                              |
| `release/`                     | installer, portable, blockmap และ `latest.yml` ไม่ commit      |

## 6. ข้อมูลและการสำรอง

- Desktop เก็บฐานข้อมูลเริ่มต้นที่ `%APPDATA%/pos-app/pos.db`
- ผู้ดูแลสามารถเปลี่ยนตำแหน่งฐานข้อมูลจากหน้า Login หรือ Settings
- ค่า `APP_SECRET` ของ Desktop สร้างครั้งแรกและเก็บใน user data ของแอป
- การเปลี่ยน schema ต้องสร้าง migration และ commit ไฟล์ใน `web/db/migrations/`
- ห้ามใช้ `db:push` กับฐานข้อมูลหน้างาน เพราะอาจทำให้โครงสร้างไม่ตรงกับประวัติ migration
- ไฟล์สำรองอัตโนมัติ `pos-auto-*` และไฟล์สำรองเอง `pos-backup-*` อยู่ในโฟลเดอร์ `backups` ข้างฐานข้อมูล
- ก่อนอัปเกรดใหญ่หรือกู้คืนข้อมูลควรสร้างไฟล์สำรองใหม่เสมอ

## 7. คำสั่งสำคัญ

| คำสั่ง                      | ใช้สำหรับ                                       |
| --------------------------- | ----------------------------------------------- |
| `npm install`               | ติดตั้ง dependencies                            |
| `npm run dev`               | พัฒนา Web โดยใช้ `./data/pos.db`                |
| `npm run dev:desktop`       | พัฒนา Desktop โดยใช้ฐานข้อมูล Desktop จริง      |
| `npm run check`             | ตรวจ TypeScript                                 |
| `npm run lint`              | ตรวจรูปแบบและกฎ ESLint                          |
| `npm test`                  | รัน Vitest                                      |
| `npm run build:desktop`     | build Web/API/Electron                          |
| `npm run dist:exe`          | สร้าง NSIS installer และ Portable ลง `release/` |
| `npm run publish:gcs`       | อัปโหลดไฟล์เวอร์ชันปัจจุบันไป update bucket     |
| `docker compose up --build` | รัน Web deployment ด้วย Docker                  |
| `npx vercel deploy --prod`  | deploy frontend ขึ้น Vercel (ต้องมี token)      |
| `npx @railway/cli up`       | deploy backend ขึ้น Railway (ต้องมี token)      |

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
- [ ] เพิ่ม Code Signing เพื่อลดคำเตือน Windows SmartScreen

งานต่อยอด:

- [ ] เชื่อมตู้จ่าย/มิเตอร์จริงเมื่อมีฮาร์ดแวร์และ protocol ที่รองรับ
- [ ] รองรับหลายสาขาและการซิงก์ข้อมูลขึ้นคลาวด์
- [ ] พิจารณา e-Tax Invoice และการเชื่อมระบบบัญชี

## 11. การ deploy เว็บขึ้นคลาวด์ (Vercel + Railway)

เว็บออนไลน์ใช้งานได้ที่ https://kimi-agent-pos.vercel.app (บัญชีเริ่มต้นตาม seed: `admin`/`1234`, `manager`/`2222`, `somchai`/`0000` — ควรเปลี่ยน PIN ทันที)

| ส่วน     | บริการ         | รายละเอียด                                                                                                                    |
| -------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Vercel         | project `kimi-agent-pos` — static build จาก `npx vite build` ลง `dist/public`; `vercel.json` ตั้ง rewrite และ SPA fallback    |
| Backend  | Railway        | project `pos-pump-api` service `api` ที่ `api-production-dc37.up.railway.app` — build จาก `web/Dockerfile` ตาม `railway.toml` |
| Database | Railway volume | SQLite ที่ `/data/pos.db` บน volume ถาวร; entrypoint migrate + seed เองตอน boot                                               |

เหตุที่ไม่ deploy backend บน Vercel: serverless function ไม่มีระบบไฟล์ถาวรและไม่รองรับ `better-sqlite3` (native module) ข้อมูล POS จะหายทุก cold start — Vercel จึงเก็บเฉพาะ frontend แล้ว rewrite `/api/*` ไป Railway (ไม่มีปัญหา CORS เพราะเป็นโดเมนเดียวกันจากมุมมอง browser)

ตัวแปรแวดล้อมบน Railway: `APP_ID`, `APP_SECRET` (สุ่มตอน deploy), `SEED_ON_START=true`

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
