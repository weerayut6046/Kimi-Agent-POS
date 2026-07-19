# แผนพัฒนาระบบ POS ปั๊มน้ำมัน — เวอร์ชัน Desktop App (.exe)

เอกสารต่อจาก `plan.md` (เวอร์ชัน Web/Docker) — อธิบายการแปลงระบบเป็น Desktop Application สำหรับ Windows

---

## 1. เป้าหมาย

- แอปเดสก์ท็อปไฟล์ `.exe` ตัวเดียว ติดตั้ง/เปิดใช้บนเครื่อง Windows ที่ปั๊มได้ทันที ไม่ต้องลง Node.js, MySQL หรือ Docker
- ใช้โค้ดระบบเดิม (React + tRPC + Drizzle) เกือบทั้งหมด ไม่เขียนระบบใหม่
- ข้อมูลอยู่ในเครื่อง ใช้งานออฟไลน์ได้ 100%

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

### การเปลี่ยนแปลงหลักจากเวอร์ชัน Web/MySQL
| ส่วน | เดิม (MySQL) | ใหม่ (Desktop/SQLite) |
|---|---|---|
| Driver | `drizzle-orm/mysql2` | `drizzle-orm/better-sqlite3` |
| Schema | `mysqlTable`, `serial`, `mysqlEnum`, `decimal`, `timestamp` | `sqliteTable`, `integer` autoincrement, `text({enum})`, `real`, `integer` timestamp_ms |
| คืน id หลัง insert | `$returningId()` | `.returning({ id })` |
| Upsert | `onDuplicateKeyUpdate` | `onConflictDoUpdate` |
| Transaction | async callback | **sync callback** (ข้อจำกัด better-sqlite3) ใช้ `.run()/.all()/.get()` |
| Migrations | ชุด MySQL | ชุด SQLite ใหม่ใน `web/db/migrations/` |

## 3. คำสั่งที่เกี่ยวข้อง

| คำสั่ง | ความหมาย |
|---|---|
| `npm run dev` + `npm run dev:desktop` | พัฒนาแบบ desktop (Electron ชี้ไป vite dev server) |
| `npm run build:desktop` | build frontend + backend + Electron bundle ลง `dist/` |
| `npm run dist:exe` | สร้าง installer/portable `.exe` ลง `release/` (ครอบ `desktop/scripts/pack-exe.mjs`) |
| `docker compose up --build` | รันแบบ Web (ใช้ SQLite ใน volume เช่นกัน) |

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
- [x] **D6 — ทดสอบ .exe บนเครื่องจริง (ครั้งแรก)**: เปิด `win-unpacked/POS ปั๊มน้ำมัน.exe` แล้ว migrate+seed อัตโนมัติ, server ตอบที่ 127.0.0.1:3210, ล็อกอินผ่าน ✅ — เหลือทดสอบติดตั้งผ่าน NSIS installer บนเครื่องปั๊มจริง, พิมพ์ใบเสร็จ, เปิดข้ามวัน
- [x] **D8 — ตั้งค่าตำแหน่งฐานข้อมูล + สำรอง/กู้คืน**: เลือกวาง pos.db ที่ไหนก็ได้ (config.json ใน userData, เปลี่ยนจากหน้า Login หรือ Settings แล้วแอปรีสตาร์ท), สำรองออนไลน์ด้วย better-sqlite3 backup, กู้คืนจากไฟล์ในเครื่องหรืออัปโหลด .db, ดาวน์โหลดไฟล์สำรองผ่าน browser — ทำงานได้ทั้ง desktop และ web (router `dbadmin`, admin เท่านั้น)
- [x] **D9 — Auto-update (electron-updater + GitHub Releases)**: แอปที่ติดตั้งผ่าน NSIS เช็กอัปเดตจาก GitHub Releases ตอนเปิดแอป, ถามก่อนดาวน์โหลด/รีสตาร์ทด้วย native dialog, log ที่ `%APPDATA%/pos-app/logs/update.log` — portable .exe อัปเดตตัวเองไม่ได้ (ต้องโหลดไฟล์ใหม่เอง); เวอร์ชัน ≤1.0.0 ที่แจกไปแล้วไม่มี updater ต้องติดตั้งเวอร์ชันใหม่ด้วยมือครั้งเดียว
- [x] **D10 — ฟีเจอร์ปั๊มชุดใหญ่ (ขายเชื่อ / Z-report / ค่าใช้จ่าย / ประวัติราคา / audit / สำรองอัตโนมัติ)**: migration `0001` (ตาราง `debt_payments`, `expenses`, `price_changes`, `audit_logs` + `sales.customer_id` + `customers.credit_limit`), routers ใหม่ `credit`/`expenses`/`reports`/`audit`, หน้า `/debts`, `/reports`, `/expenses`, `/audit` (admin), ปุ่ม "เครดิต" ในหน้าขาย, สำรองอัตโนมัติรายวัน `web/api/lib/autobackup.ts` (ตั้งค่าในหน้า Settings ไฟล์ `pos-auto-*`) — รายละเอียดฟีเจอร์อยู่ใน `plan.md` Phase 10; **ยังไม่ได้ build .exe** — จะไปอยู่ในเวอร์ชันถัดไป (เครื่องปั๊ม migrate ต่อเองตอนเปิดแอป ข้อมูลเดิมไม่หาย)
- [x] **D7 — Multi-station ผ่าน LAN**: เครื่องลูกเปิดเบราว์เซอร์ไปที่ `http://<IP-เครื่องหลัก>:3210` ใช้งานได้ทันที (server serve ทั้งเว็บและ API โดเมนเดียวกัน) — เปิดใช้ด้วย toggle "เครือข่าย LAN" ในหน้า Settings (key `lan_enabled`, default ปิด) แล้วรีสตาร์ทแอป; `web/api/boot.ts` อ่าน setting นี้ตอน bind (`BIND_HOST` env มีสิทธิ์เหนือ, Docker pin `0.0.0.0` ใน Dockerfile), endpoint `catalog.lanInfo` คืน IP/port ให้หน้า Settings + หน้า Login แสดง URL — **กะรวมใช้ร่วมกันทุกเครื่อง** (ยอดขายระบุ staffName รายคน, เลขใบเสร็จกันชนด้วย sync transaction) — ข้อจำกัด: auth แบบ header ปลอมได้จากเครื่องใน LAN (ใช้เฉพาะ LAN ที่เชื่อถือ), auto-print ESC/POS ไปเครื่องพิมพ์กลางตัวเดียว (เครื่องลูกพิมพ์ผ่านเบราว์เซอร์ของตัวเองได้), Windows Firewall ครั้งแรกต้องกด Allow หรือเพิ่ม rule ด้วย netsh (คำสั่งอยู่ในหน้า Settings)

### การปล่อยเวอร์ชันใหม่ (auto-update)
1. เปลี่ยน `version` ใน `package.json` (เช่น 1.0.1) แล้ว `npm run dist:exe -- -c.directories.output=release3`
2. สร้าง GitHub Release ที่ repo `weerayut6046/Kimi-Agent-POS` (tag เช่น `v1.0.1`) อัปโหลด 3 ไฟล์จากโฟลเดอร์ output: `POS-Pump-Setup-<version>.exe`, `POS-Pump-Setup-<version>.exe.blockmap`, `latest.yml`
3. เครื่องที่ติดตั้งด้วย NSIS เวอร์ชันเก่าจะเห็น dialog อัปเดตตอนเปิดแอป — เช็กเลขเวอร์ชันมุมขวาล่างหน้า Login หลังรีสตาร์ทเพื่อยืนยัน

## 6. ความเสี่ยงและข้อควรระวัง

| ความเสี่ยง | แนวทางรับมือ |
|---|---|
| better-sqlite3 เป็น native module | electron-builder rebuild ตอนแพ็กเกจ; ถ้าเครื่อง build ไม่มี VS Build Tools ต้องใช้เวอร์ชันที่มี prebuilt binary |
| ข้อมูลเดิมใน MySQL ไม่ได้ย้าย | เวอร์ชัน SQLite เริ่มฐานใหม่; ถ้าต้องย้ายข้อมูลเก่า ทำสคริปต์ export/import แยก |
| port 3210 ชนโปรแกรมอื่น | ตั้ง `PORT` ใน env ของ shortcut ได้; มี single-instance lock กันเปิดซ้อน |
| ไฟดับระหว่างเขียนข้อมูล | SQLite journal mode WAL + transaction ทุกจุดสำคัญ; แนะนำ UPS + สำรอง pos.db ทุกวัน |
| Windows Defender/SmartScreen เตือน exe ไม่มีลายเซ็น | แจ้งผู้ใช้กด Run anyway (รุ่นแรกยังไม่ sign); อนาคตซื้อ code-signing certificate |

---

*สถาปัตยกรรมและคำสั่งทั้งหมดสะท้อนโค้ดปัจจุบัน — ถ้าเปลี่ยน build/packaging ให้อัปเดตเอกสารนี้ด้วย*
