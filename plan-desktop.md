# แผนพัฒนาระบบ POS ปั๊มน้ำมัน — เวอร์ชัน Desktop App (.exe)

เอกสารต่อจาก [`plan.md`](./plan.md) — อธิบายสถาปัตยกรรม สถานะ และการปล่อย Desktop Application สำหรับ Windows

> อัปเดตล่าสุด: 22 กรกฎาคม 2026 — source/build และรุ่นเผยแพร่ `2.0.5` ดูภาพรวมโครงการได้ที่ [`PROJECT.md`](./PROJECT.md)

---

## 1. เป้าหมาย

- ชุด Desktop มี NSIS installer และ Portable `.exe` เปิดใช้บน Windows ได้โดยไม่ต้องลง Node.js, MySQL หรือ Docker
- ใช้โค้ดระบบเดิม (React + tRPC + Drizzle) เกือบทั้งหมด ไม่เขียนระบบใหม่
- ใช้ฐานข้อมูลกลาง Supabase ร่วมกับเว็บและจุดขายทุกเครื่อง จึงต้องเชื่อมต่ออินเทอร์เน็ต
- รองรับจอขนาดเล็กและอัปเดต NSIS installer ผ่าน Google Cloud Storage
- ตัวติดตั้งเป็น Wizard ภาษาไทยพร้อม EULA/แบรนด์ KY และติดตั้งแบบ per-machine ใน `Program Files`

## 2. สถาปัตยกรรม

```
Electron BrowserWindow
        │ HTTPS
        ▼
Vercel Frontend ── /api/* ──▶ Railway Hono/tRPC
                                      │ Drizzle + postgres.js
                                      ▼
                           Supabase PostgreSQL (`pos`)
```

- **Electron** (`desktop/electron/main.ts`): เปิด `https://kimi-agent-pos.vercel.app`, คง IPC สำหรับพิมพ์และ auto-update, มี single-instance lock
- **Railway backend**: ถือ `APP_SECRET` และ database secret เชื่อม Supabase ผ่าน session pooler; browser/Desktop ไม่เห็น secret
- **Supabase PostgreSQL**: ตารางอยู่ใน private schema `pos`, เปิด RLS เป็น defense in depth และไม่เปิด Data API ให้ client
- **electron-builder**: แพ็กเกจเป็น NSIS installer + portable .exe ลง `release/`
- **electron-updater**: แอป NSIS อ่าน `latest.yml` และดาวน์โหลด installer/blockmap จาก `https://storage.googleapis.com/kimi-agent-pos-updates/`; Portable ต้องดาวน์โหลดรุ่นใหม่เอง

### การเปลี่ยนแปลงหลักใน 2.0.0

| ส่วน       | 1.x (Desktop/SQLite)       | 2.0.0 (ระบบกลาง)                                  |
| ---------- | -------------------------- | ------------------------------------------------- |
| ฐานข้อมูล  | ไฟล์ `pos.db` ต่อเครื่อง   | Supabase PostgreSQL private schema `pos`          |
| Desktop    | รัน Hono + DB ในเครื่อง    | โหลดเว็บ production และคง IPC พิมพ์/อัปเดต        |
| หลายจุดขาย | LAN ไปเครื่องหลัก          | HTTPS ไป Vercel/Railway/Supabase ชุดเดียวกัน      |
| Session    | header ที่ client กำหนดได้ | token HMAC ที่ backend ลงลายเซ็น                  |
| Backup     | ไฟล์ SQLite ในเครื่อง      | Supabase Daily Backup + Private GCS ทุก 6 ชั่วโมง |

## 3. คำสั่งที่เกี่ยวข้อง

| คำสั่ง                      | ความหมาย                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:desktop`       | พัฒนา Desktop ผ่าน Vite โดยตั้ง `DATABASE_URL` ของ Supabase; ปิด Electron แล้ว Vite ที่ script เปิดจะปิดตาม           |
| `npm run build:desktop`     | build frontend + backend + Electron bundle ลง `dist/`                                                                 |
| `npm run dist:exe`          | สร้าง installer/portable `.exe` ลง `release/` (ครอบ `desktop/scripts/pack-exe.mjs`)                                   |
| `npm run publish:gcs`       | อัปโหลด installer, Portable, blockmap และ `latest.yml` ของเวอร์ชันปัจจุบันไป GCS พร้อมตั้ง cache metadata และตรวจ URL |
| `docker compose up --build` | รัน Web/backend โดยเชื่อม Supabase จาก environment variables                                                          |

Desktop 2.0.0 ไม่มี native database module แล้ว จึงไม่ต้อง rebuild `better-sqlite3` สำหรับ Electron ABI

## 4. ข้อมูลและการสำรอง

- Desktop ไม่เก็บไฟล์ฐานข้อมูล, `DATABASE_URL` หรือ `APP_SECRET`
- ข้อมูลอยู่ใน Supabase private schema `pos`; การเปลี่ยน schema ใช้ migration ใน `web/db/migrations-postgres/`
- ใช้ Supabase Pro Daily Backup 7 วันร่วมกับ Logical Backup ทุก 6 ชั่วโมงไป Private GCS; admin ดูสถานะและดาวน์โหลดจาก Settings
- SQLite ต้นทางใน `data/` เก็บไว้เป็นหลักฐานช่วงเปลี่ยนผ่านและไม่ถูกโหลดโดยแอปรุ่น 2.0.0

## 5. แผนงาน (สถานะ)

- [x] **D1 — แปลง DB layer เป็น SQLite**: schema/connection/routers/migrations/seed, แก้จุด MySQL-specific ทั้งหมด
- [x] **D2 — Electron shell**: `desktop/electron/main.ts`, single instance, BrowserWindow และ IPC พิมพ์
- [x] **D3 — Build pipeline**: script `build:desktop`/`dist:exe`, electron-builder (NSIS + portable)
- [x] **D4 — Docker/web**: container backend แบบ long-lived เชื่อม Supabase ผ่าน session pooler
- [x] **D5 — ตรวจสอบระบบ**: tsc ผ่าน, smoke test ผ่านครบ (ล็อกอิน/เปิดกะ/ขาย/แต้ม/ปิดกะ/หักถัง/แดชบอร์ด)
- [x] **D6 — Desktop smoke test**: เปิดแอปจาก `win-unpacked`, โหลด production URL และคง IPC พิมพ์; การตรวจเครื่องปั๊มจริงแยกไว้ใน D15
- [x] **D7 — Multi-station**: รุ่น 2.0.0 แทน LAN server ด้วยระบบกลาง Vercel/Railway/Supabase และ signed staff session
- [x] **D8 — ฐานข้อมูลและ backup**: รุ่น 2.0.0 ย้ายข้อมูลขึ้น Supabase พร้อม Supabase Daily Backup และ Private GCS Backup ทุก 6 ชั่วโมงแทนไฟล์ SQLite
- [x] **D9 — Auto Update รุ่นแรก**: เพิ่ม `electron-updater`, dialog ถามก่อนดาวน์โหลด/รีสตาร์ท และ log ที่ `%APPDATA%/pos-app/logs/update.log`; Portable อัปเดตตัวเองไม่ได้
- [x] **D10 — ฟีเจอร์ปั๊มชุดใหญ่**: ขายเชื่อ, Z-report, ค่าใช้จ่าย, ประวัติราคา, Audit log และสำรองอัตโนมัติ รวมอยู่ใน Desktop ที่ build แล้วถึง `1.0.20`
- [x] **D11 — Settings persistence/loading**: แก้โหลดข้อมูลเมื่อเข้าหน้า Settings ครั้งแรกและหลังสลับเมนู พร้อม refresh ค่าล่าสุดหลังบันทึก (`1.0.15`)
- [x] **D12 — ใบกำกับภาษี A5**: เพิ่มตัวเลือก A4/A5 และปรับ preview/print layout (`1.0.16`)
- [x] **D13 — Responsive Desktop**: ปรับขนาดเริ่มต้นตามพื้นที่จอจริง เมนูแบบสไลด์ และ scroll หน้า/dialog บนจอเล็ก (`1.0.17`)
- [x] **D14 — ย้าย Auto Update ไป GCS**: ตั้ง generic provider, สร้าง bucket สาธารณะ, เพิ่ม `publish:gcs` และเผยแพร่ต่อเนื่องถึง `1.0.20`
- [ ] **D15 — ตรวจรับหน้างาน**: ทดสอบ NSIS installer, Settings, เครื่องพิมพ์, A4/A5, อินเทอร์เน็ตหลุด/กลับมา และเปิดข้ามวันบนเครื่องปั๊มจริง
- [ ] **D16 — ทดสอบ updater รุ่นใหม่**: ทดสอบ `2.0.4` → `2.0.5` แบบ end-to-end และบันทึกผล
- [x] **D17 — Code Signing**: ทำใน `1.0.24` แบบ self-signed certificate (`CN=PumpPOS Code Signing`, RSA-2048 อายุ 10 ปี) — private key เก็บที่ `desktop/certs/pumpos-codesign.pfx` (ไม่ commit), public cert ที่ `desktop/certs/pumpos-codesign.cer`; `pack-exe.mjs` ตั้ง `CSC_LINK`/`CSC_KEY_PASSWORD` ให้ electron-builder sign ทุก target (app exe, uninstaller, NSIS installer, Portable) อัตโนมัติ — เครื่อง build อื่นที่ไม่มี pfx จะ build unsigned เหมือนเดิม; **เครื่องปลายทางต้อง import root cert ครั้งเดียว** ด้วย `certs/install-pos-root-cert.bat` (แนบในตัวติดตั้งผ่าน `extraFiles`, รัน as admin) เพื่อให้ Smart App Control/SmartScreen ยอมรับ; ยังเหลืออัปเกรดเป็น OV/EV cert ถ้าต้องแจกจ่ายกว้าง
- [x] **D18 — UX/UI Station Console**: ปรับ design system, navigation แบ่งกลุ่ม, Login, Dashboard, POS, touch targets, safe-area และ mobile cart sheet (`1.0.20`)
- [x] **D19 — เอกสารลูกค้าเครดิต**: เพิ่มใบขอเปิดบัญชีเครดิตและรายการรถบรรทุก/เครื่องจักร A4 พร้อม preview/print และจำกัดสิทธิ์ admin/manager (`1.0.20`)
- [x] **D20 — Installer Wizard ภาษาไทย**: เพิ่มหน้าต้อนรับ, EULA, เลือกโฟลเดอร์, หน้าพร้อมติดตั้ง, ไอคอน/ภาพแบรนด์ KY และตั้ง per-machine สำหรับผู้ใช้ทุกคนใน `Program Files` (`1.0.21`, build ในเครื่อง)
- [x] **D21 — Supabase central database (`2.0.0`)**: migrate schema/data เดิมครบ 25 ตาราง, เปลี่ยน Desktop เป็น online shell, deploy Vercel/Railway, signed staff session, session pooler และแก้ Dashboard loading timeout
- [x] **D22 — Offline-first sales (`2.0.2`)**: ฝัง frontend bundle ใน Desktop, cache ข้อมูลอ่าน, เก็บคิวบิลลงดิสก์, ซิงก์อัตโนมัติเมื่อออนไลน์ และใช้ idempotent API/atomic updates ป้องกันข้อมูลซ้ำเมื่อ retry
- [x] **D23 — Modern Command Center UI (`2.0.3`)**: ยกเครื่อง design system, navigation, Login, Dashboard, POS, Quick Menu และ Tank Telemetry รูปถังพร้อมระดับของเหลวเคลื่อนไหว
- [x] **D24 — Tank ordering และ shift precision (`2.0.4`)**: เพิ่มการลากสลับตำแหน่งถังพร้อมบันทึกลำดับส่วนกลาง แสดงรหัสถัง และคำนวณลิตรตอนตัดกะ/หักสต๊อกด้วยทศนิยม 3 ตำแหน่ง
- [x] **D25 — Reliable Auto Update และ fuel colors (`2.0.5`)**: แสดง progress/ความเร็วบนหน้าต่างและ taskbar, แจ้ง error พร้อม retry/manual installer, ปิด differential download สำหรับ GCS และเปลี่ยนสีของเหลวในถังตามชนิดน้ำมัน

### การปล่อยเวอร์ชันใหม่ (auto-update)

1. เปลี่ยน `version` ใน `package.json` และ `package-lock.json`
2. รัน `npm run check`, `npm run lint` และ `npm test`
3. รัน `npm run dist:exe` แล้วตรวจ `release/latest.yml` กับ `release/win-unpacked/resources/app-update.yml`
4. ยืนยัน `gcloud auth list` และ project `kimi-agent-pos` แล้วรัน `npm run publish:gcs`
5. ตรวจ URL ของ installer, Portable, blockmap และ `latest.yml` ว่าตอบ HTTP 200 และขนาดตรงกับไฟล์ local
6. Commit/push source และสร้าง tag เมื่อประกาศ release อย่างเป็นทางการ
7. ทดสอบ Auto Update จากเวอร์ชันก่อนหน้า แล้วเช็กเลขเวอร์ชันมุมขวาล่างหน้า Login หลังรีสตาร์ท

> การเปลี่ยนผ่าน: แอป `1.0.17` และเก่ากว่ายังชี้ GitHub Releases ต้องติดตั้ง `1.0.18` ด้วยมือหนึ่งครั้ง หรือเผยแพร่ `1.0.18` บน GitHub เป็น bridge release หลังจากนั้น updater จะใช้ GCS

## 6. ความเสี่ยงและข้อควรระวัง

| ความเสี่ยง                                | แนวทางรับมือ                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| อินเทอร์เน็ตขาดระหว่างขาย                 | รุ่น 2.0.2 เก็บบิลเงินสด/QR/บัตรใน durable outbox และซิงก์เมื่อออนไลน์; ขายเชื่อ/ใช้แต้มต้องรอออนไลน์ |
| Supabase/Railway/Vercel ขัดข้อง           | ตรวจ status/log, คง SQLite ต้นทางสำหรับตรวจสอบ และใช้แผน backup/PITR                                |
| Windows Defender/SmartScreen เตือน        | build sign ด้วย self-signed cert; เครื่องปลายทางต้อง import root cert หรืออัปเกรดเป็น OV/EV ในอนาคต |
| รุ่นเก่าไม่รู้จัก GCS                     | ติดตั้ง `1.0.18` ด้วยมือหรือทำ GitHub bridge release หนึ่งครั้ง                                     |
| อัปโหลด `latest.yml` ก่อน installer เสร็จ | ใช้ `npm run publish:gcs` และตรวจ URL/ขนาดทุกไฟล์ก่อนแจ้งผู้ใช้                                     |
| GCS ขัดข้อง                               | updater เขียน log และลองใหม่เมื่อเปิดแอปครั้งถัดไป; เว็บ production ยังใช้งานได้                    |

---

_สถาปัตยกรรมและคำสั่งทั้งหมดสะท้อนโค้ดปัจจุบัน — ถ้าเปลี่ยน build/packaging ให้อัปเดตเอกสารนี้ด้วย_
