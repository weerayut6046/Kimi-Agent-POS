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
- **สำรองข้อมูล** = ปิดแอปแล้ว copy `pos.db` ไปเก็บ; **กู้คืน** = วางทับแล้วเปิดแอป
- ล้างข้อมูลเริ่มใหม่ = ลบ `pos.db` แล้วเปิดแอป (จะ migrate + seed ใหม่)

## 5. แผนงาน (สถานะ)

- [x] **D1 — แปลง DB layer เป็น SQLite**: schema/connection/routers/migrations/seed, แก้จุด MySQL-specific ทั้งหมด
- [x] **D2 — Electron shell**: `desktop/electron/main.ts`, env อัตโนมัติ, migrate+seed ตอนเปิดแอป, single instance
- [x] **D3 — Build pipeline**: script `build:desktop`/`dist:exe`, electron-builder (NSIS + portable)
- [x] **D4 — Docker/web ให้ทำงานกับ SQLite ต่อได้**: compose เหลือ service เดียว, Dockerfile ใช้ bookworm-slim
- [x] **D5 — ตรวจสอบระบบ**: tsc ผ่าน, smoke test ผ่านครบ (ล็อกอิน/เปิดกะ/ขาย/แต้ม/ปิดกะ/หักถัง/แดชบอร์ด)
- [x] **D6 — ทดสอบ .exe บนเครื่องจริง (ครั้งแรก)**: เปิด `win-unpacked/POS ปั๊มน้ำมัน.exe` แล้ว migrate+seed อัตโนมัติ, server ตอบที่ 127.0.0.1:3210, ล็อกอินผ่าน ✅ — เหลือทดสอบติดตั้งผ่าน NSIS installer บนเครื่องปั๊มจริง, พิมพ์ใบเสร็จ, เปิดข้ามวัน
- [ ] **D7 — ต่อยอด (อนาคต)**: auto-update (electron-updater), ปุ่มสำรองข้อมูลในหน้า Settings, เครื่องพิมพ์ความร้อน ESC/POS, โหมด offline multi-station ผ่าน LAN (ชี้ client ไปที่ server เครื่องหลัก)

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
