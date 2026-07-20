# แผนพัฒนาระบบ POS ปั๊มน้ำมัน — เวอร์ชัน Desktop App (.exe)

เอกสารต่อจาก [`plan.md`](./plan.md) — อธิบายสถาปัตยกรรม สถานะ และการปล่อย Desktop Application สำหรับ Windows

> อัปเดตล่าสุด: 20 กรกฎาคม 2026 — source/build ในเครื่อง `1.0.21`; รุ่นเผยแพร่ `1.0.20` ดูภาพรวมโครงการได้ที่ [`PROJECT.md`](./PROJECT.md)

---

## 1. เป้าหมาย

- ชุด Desktop มี NSIS installer และ Portable `.exe` เปิดใช้บน Windows ได้โดยไม่ต้องลง Node.js, MySQL หรือ Docker
- ใช้โค้ดระบบเดิม (React + tRPC + Drizzle) เกือบทั้งหมด ไม่เขียนระบบใหม่
- ข้อมูลอยู่ในเครื่อง ใช้งานออฟไลน์ได้ 100%
- รองรับจอขนาดเล็กและอัปเดต NSIS installer ผ่าน Google Cloud Storage
- ตัวติดตั้งเป็น Wizard ภาษาไทยพร้อม EULA/แบรนด์ KY และติดตั้งแบบ per-machine ใน `Program Files`

## 2. สถาปัตยกรรม

```
┌─────────────────────────────────────────────┐
│ Electron App (POS ปั๊มน้ำมัน.exe)            │
│                                             │
│  ┌───────────────┐    ┌──────────────────┐  │
│  │ BrowserWindow │───▶│ Hono + tRPC      │  │
│  │ (React UI)    │    │ server (in-proc) │  │
│  └───────────────┘    └────────┬─────────┘  │
│       http://127.0.0.1:3210    │ Drizzle ORM│
│                                ▼            │
│                        SQLite (better-      │
│                        sqlite3)             │
│                        %APPDATA%/pos-app/   │
│                        pos.db               │
└─────────────────────────────────────────────┘
```

- **Electron** (`desktop/electron/main.ts`): ตั้ง env → migrate → seed (ครั้งแรก) → สตาร์ท Hono server บน `127.0.0.1:3210` → เปิดหน้าต่างชี้เข้าตัวเอง, มี single-instance lock
- **SQLite (better-sqlite3)**: ฐานข้อมูลฝังในแอป ไฟล์เดียวที่ `%APPDATA%/pos-app/pos.db` — ใช้ schema เดียวกันทั้ง desktop และ Docker/web (เปลี่ยนจาก MySQL ทั้งระบบ)
- **electron-builder**: แพ็กเกจเป็น NSIS installer + portable .exe ลง `release/`
- **electron-updater**: แอป NSIS อ่าน `latest.yml` และดาวน์โหลด installer/blockmap จาก `https://storage.googleapis.com/kimi-agent-pos-updates/`; Portable ต้องดาวน์โหลดรุ่นใหม่เอง

### การเปลี่ยนแปลงหลักจากเวอร์ชัน Web/MySQL

| ส่วน               | เดิม (MySQL)                                                | ใหม่ (Desktop/SQLite)                                                                  |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Driver             | `drizzle-orm/mysql2`                                        | `drizzle-orm/better-sqlite3`                                                           |
| Schema             | `mysqlTable`, `serial`, `mysqlEnum`, `decimal`, `timestamp` | `sqliteTable`, `integer` autoincrement, `text({enum})`, `real`, `integer` timestamp_ms |
| คืน id หลัง insert | `$returningId()`                                            | `.returning({ id })`                                                                   |
| Upsert             | `onDuplicateKeyUpdate`                                      | `onConflictDoUpdate`                                                                   |
| Transaction        | async callback                                              | **sync callback** (ข้อจำกัด better-sqlite3) ใช้ `.run()/.all()/.get()`                 |
| Migrations         | ชุด MySQL                                                   | ชุด SQLite ใหม่ใน `web/db/migrations/`                                                 |

## 3. คำสั่งที่เกี่ยวข้อง

| คำสั่ง                      | ความหมาย                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev:desktop`       | พัฒนาแบบ desktop คำสั่งเดียว — script เปิด Vite โดยชี้ `%APPDATA%/pos-app/pos.db` หรือตำแหน่งที่ผู้ใช้เลือกไว้ให้ตรงกับ Desktop จริง; ถ้าพอร์ต 3000 มี web dev ที่ใช้ DB คนละไฟล์จะเลือกพอร์ตถัดไปอัตโนมัติ; ปิด Electron แล้ว Vite ที่ script เปิดจะปิดตาม |
| `npm run build:desktop`     | build frontend + backend + Electron bundle ลง `dist/`                                                                                                                                                                                                       |
| `npm run dist:exe`          | สร้าง installer/portable `.exe` ลง `release/` (ครอบ `desktop/scripts/pack-exe.mjs`)                                                                                                                                                                         |
| `npm run publish:gcs`       | อัปโหลด installer, Portable, blockmap และ `latest.yml` ของเวอร์ชันปัจจุบันไป GCS พร้อมตั้ง cache metadata และตรวจ URL                                                                                                                                       |
| `docker compose up --build` | รันแบบ Web (ใช้ SQLite ใน volume เช่นกัน)                                                                                                                                                                                                                   |

### เรื่อง native module (better-sqlite3) ตอน build .exe

เครื่อง build ไม่มี Visual Studio จึง compile เองไม่ได้ — `desktop/scripts/pack-exe.mjs` ทำให้อัตโนมัติ:

1. ดาวน์โหลด prebuilt binary จาก GitHub Releases ของ better-sqlite3 (cache ใน `.cache/native/`)
2. สลับ binary ใน `node_modules` เป็น **Electron ABI** ชั่วคราว → รัน electron-builder (`npmRebuild: false`) → สลับกลับเป็น Node ABI สำหรับ dev
3. ดังนั้น **Electron ต้องตรงเวอร์ชันที่มี prebuilt** — ปัจจุบัน pin ที่ Electron 42 (ABI v146) ถ้าจะอัปเกรด Electron ให้เช็กก่อนว่า better-sqlite3 มี prebuilt ของ ABI นั้น

> หมายเหตุ: ถ้ารัน electron จาก shell ที่ตั้ง `ELECTRON_RUN_AS_NODE=1` ไว้ แอปจะทำงานผิดปกติ (ตัวแปรนี้ทำให้ electron กลายเป็น node ธรรมดา) — shell ปกติของผู้ใช้ไม่มีตัวแปรนี้

## 4. ข้อมูลและการสำรอง

- ไฟล์ฐานข้อมูล: `%APPDATA%/pos-app/pos.db` (+ ไฟล์ WAL ขณะเปิดแอป)
- `APP_SECRET` สุ่มครั้งแรกและเก็บที่ `%APPDATA%/pos-app/.app-secret`
- **สำรองข้อมูล** = ปิดแอปแล้ว copy `pos.db` ไปเก็บ; **กู้คืน** = วางทับแล้วเปิดแอป (หรือใช้เมนูสำรอง/กู้ในหน้า Settings — admin)
- **สำรองอัตโนมัติรายวัน**: เปิดได้ในหน้า Settings (ตั้งเวลา + จำนวนไฟล์ที่เก็บ) ไฟล์ `pos-auto-*` อยู่ในโฟลเดอร์ `backups` ข้างฐานข้อมูล แยกจากไฟล์ที่สำรองเอง (`pos-backup-*`)
- ล้างข้อมูลเริ่มใหม่ = ลบ `pos.db` แล้วเปิดแอป (จะ migrate + seed ใหม่)

## 5. แผนงาน (สถานะ)

- [x] **D1 — แปลง DB layer เป็น SQLite**: schema/connection/routers/migrations/seed, แก้จุด MySQL-specific ทั้งหมด
- [x] **D2 — Electron shell**: `desktop/electron/main.ts`, env อัตโนมัติ, migrate+seed ตอนเปิดแอป, single instance
- [x] **D3 — Build pipeline**: script `build:desktop`/`dist:exe`, electron-builder (NSIS + portable)
- [x] **D4 — Docker/web ให้ทำงานกับ SQLite ต่อได้**: compose เหลือ service เดียว, Dockerfile ใช้ bookworm-slim
- [x] **D5 — ตรวจสอบระบบ**: tsc ผ่าน, smoke test ผ่านครบ (ล็อกอิน/เปิดกะ/ขาย/แต้ม/ปิดกะ/หักถัง/แดชบอร์ด)
- [x] **D6 — Desktop smoke test**: เปิดแอปจาก `win-unpacked`, migrate/seed อัตโนมัติ, server ตอบที่ `127.0.0.1:3210` และล็อกอินได้; การตรวจเครื่องปั๊มจริงแยกไว้ใน D15
- [x] **D7 — Multi-station ผ่าน LAN**: เครื่องลูกเปิดเบราว์เซอร์ไปที่ `http://<IP-เครื่องหลัก>:3210` ใช้งานได้ทันที (server serve ทั้งเว็บและ API โดเมนเดียวกัน) — เปิดใช้ด้วย toggle "เครือข่าย LAN" ในหน้า Settings (key `lan_enabled`, default ปิด) แล้วรีสตาร์ทแอป; `web/api/boot.ts` อ่าน setting นี้ตอน bind (`BIND_HOST` env มีสิทธิ์เหนือ, Docker pin `0.0.0.0` ใน Dockerfile), endpoint `catalog.lanInfo` คืน IP/port ให้หน้า Settings + หน้า Login แสดง URL — **กะรวมใช้ร่วมกันทุกเครื่อง** (ยอดขายระบุ staffName รายคน, เลขใบเสร็จกันชนด้วย sync transaction) — ข้อจำกัด: auth แบบ header ปลอมได้จากเครื่องใน LAN (ใช้เฉพาะ LAN ที่เชื่อถือ), ใบเสร็จพิมพ์ผ่านเบราว์เซอร์ของแต่ละเครื่อง (ถอดฟีเจอร์ ESC/POS ออกแล้ว), Windows Firewall ครั้งแรกต้องกด Allow หรือเพิ่ม rule ด้วย netsh (คำสั่งอยู่ในหน้า Settings)
- [x] **D8 — ตั้งค่าตำแหน่งฐานข้อมูล + สำรอง/กู้คืน**: เลือกวาง `pos.db` ได้ (config ใน userData), สำรองออนไลน์ด้วย better-sqlite3 backup, กู้คืนจากไฟล์ในเครื่องหรืออัปโหลด `.db`, ดาวน์โหลดไฟล์สำรองผ่าน browser — router `dbadmin`, admin เท่านั้น
- [x] **D9 — Auto Update รุ่นแรก**: เพิ่ม `electron-updater`, dialog ถามก่อนดาวน์โหลด/รีสตาร์ท และ log ที่ `%APPDATA%/pos-app/logs/update.log`; Portable อัปเดตตัวเองไม่ได้
- [x] **D10 — ฟีเจอร์ปั๊มชุดใหญ่**: ขายเชื่อ, Z-report, ค่าใช้จ่าย, ประวัติราคา, Audit log และสำรองอัตโนมัติ รวมอยู่ใน Desktop ที่ build แล้วถึง `1.0.20`
- [x] **D11 — Settings persistence/loading**: แก้โหลดข้อมูลเมื่อเข้าหน้า Settings ครั้งแรกและหลังสลับเมนู พร้อม refresh ค่าล่าสุดหลังบันทึก (`1.0.15`)
- [x] **D12 — ใบกำกับภาษี A5**: เพิ่มตัวเลือก A4/A5 และปรับ preview/print layout (`1.0.16`)
- [x] **D13 — Responsive Desktop**: ปรับขนาดเริ่มต้นตามพื้นที่จอจริง เมนูแบบสไลด์ และ scroll หน้า/dialog บนจอเล็ก (`1.0.17`)
- [x] **D14 — ย้าย Auto Update ไป GCS**: ตั้ง generic provider, สร้าง bucket สาธารณะ, เพิ่ม `publish:gcs` และเผยแพร่ต่อเนื่องถึง `1.0.20`
- [ ] **D15 — ตรวจรับหน้างาน**: ทดสอบ NSIS installer, Settings, เครื่องพิมพ์, A4/A5, backup/restore, LAN และเปิดข้ามวันบนเครื่องปั๊มจริง
- [ ] **D16 — ทดสอบ updater รุ่นใหม่**: ทดสอบ `1.0.20` → เวอร์ชันถัดไปแบบ end-to-end และบันทึกผล
- [ ] **D17 — Code Signing**: ลงลายเซ็น installer/Portable เพื่อลดคำเตือน Windows SmartScreen
- [x] **D18 — UX/UI Station Console**: ปรับ design system, navigation แบ่งกลุ่ม, Login, Dashboard, POS, touch targets, safe-area และ mobile cart sheet (`1.0.20`)
- [x] **D19 — เอกสารลูกค้าเครดิต**: เพิ่มใบขอเปิดบัญชีเครดิตและรายการรถบรรทุก/เครื่องจักร A4 พร้อม preview/print และจำกัดสิทธิ์ admin/manager (`1.0.20`)
- [x] **D20 — Installer Wizard ภาษาไทย**: เพิ่มหน้าต้อนรับ, EULA, เลือกโฟลเดอร์, หน้าพร้อมติดตั้ง, ไอคอน/ภาพแบรนด์ KY และตั้ง per-machine สำหรับผู้ใช้ทุกคนใน `Program Files` (`1.0.21`, build ในเครื่อง)

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

| ความเสี่ยง                                          | แนวทางรับมือ                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| better-sqlite3 เป็น native module                   | electron-builder rebuild ตอนแพ็กเกจ; ถ้าเครื่อง build ไม่มี VS Build Tools ต้องใช้เวอร์ชันที่มี prebuilt binary |
| ข้อมูลเดิมใน MySQL ไม่ได้ย้าย                       | เวอร์ชัน SQLite เริ่มฐานใหม่; ถ้าต้องย้ายข้อมูลเก่า ทำสคริปต์ export/import แยก                                 |
| port 3210 ชนโปรแกรมอื่น                             | ตั้ง `PORT` ใน env ของ shortcut ได้; มี single-instance lock กันเปิดซ้อน                                        |
| ไฟดับระหว่างเขียนข้อมูล                             | SQLite journal mode WAL + transaction ทุกจุดสำคัญ; แนะนำ UPS + สำรอง pos.db ทุกวัน                              |
| Windows Defender/SmartScreen เตือน exe ไม่มีลายเซ็น | แจ้งผู้ใช้กด Run anyway (รุ่นแรกยังไม่ sign); อนาคตซื้อ code-signing certificate                                |
| รุ่นเก่าไม่รู้จัก GCS                               | ติดตั้ง `1.0.18` ด้วยมือหรือทำ GitHub bridge release หนึ่งครั้ง                                                 |
| อัปโหลด `latest.yml` ก่อน installer เสร็จ           | ใช้ `npm run publish:gcs` และตรวจ URL/ขนาดทุกไฟล์ก่อนแจ้งผู้ใช้                                                 |
| GCS หรืออินเทอร์เน็ตขัดข้อง                         | ระบบขายยังทำงานออฟไลน์; updater เขียน log และลองใหม่เมื่อเปิดแอปครั้งถัดไป                                      |

---

_สถาปัตยกรรมและคำสั่งทั้งหมดสะท้อนโค้ดปัจจุบัน — ถ้าเปลี่ยน build/packaging ให้อัปเดตเอกสารนี้ด้วย_
