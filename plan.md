# แผนพัฒนาระบบ POS ปั๊มน้ำมัน

เอกสารแผนพัฒนาระบบตั้งแต่เริ่มต้นโครงการ จนถึงส่งมอบและต่อยอดในอนาคต

> อัปเดตล่าสุด: 22 กรกฎาคม 2026 — source/build และรุ่นเผยแพร่ `2.0.4` ดูภาพรวมปัจจุบันได้ที่ [`PROJECT.md`](./PROJECT.md)

---

## 1. ภาพรวมโครงการ

- **ชื่อระบบ:** ระบบ POS ปั๊มน้ำมัน (Kimi-Agent-POS)
- **วัตถุประสงค์:** ระบบขายหน้าร้านสำหรับปั๊มน้ำมัน ครอบคลุมการขายน้ำมัน/สินค้า, การจัดการกะและมิเตอร์หัวจ่าย, สมาชิกสะสมแต้ม, ใบกำกับภาษีเต็มรูป, สต็อกและถังน้ำมัน, รายงานยอดขาย
- **ผู้ใช้เป้าหมาย:** เจ้าของปั๊ม (admin), ผู้จัดการสาขา (manager), พนักงานขาย (cashier)
- **รูปแบบการใช้งาน:** Windows Desktop เป็นช่องทางหลัก; Portable `.exe` และ Web/Docker เป็นช่องทางเสริม

## 2. เทคโนโลยีที่ใช้

| ส่วน        | เทคโนโลยี                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Frontend    | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, react-router, TanStack Query                     |
| Backend     | Hono + tRPC (อยู่ใน repo เดียวกัน `web/api/`)                                                         |
| Database    | Supabase PostgreSQL + Drizzle ORM (private schema `pos`, migrations ใน `web/db/migrations-postgres/`) |
| Validation  | Zod                                                                                                   |
| Desktop     | Electron 42 + electron-builder (NSIS installer และ Portable)                                          |
| Deploy      | Windows `.exe`/Portable โหลดเว็บกลาง; Vercel (frontend) + Railway (backend) + Supabase (database)     |
| Auto Update | electron-updater + Google Cloud Storage (generic provider)                                            |
| เครื่องมือ  | ESLint, Prettier, Vitest, drizzle-kit                                                                 |

โครงสร้างหลัก: `web/` คือ web app ทั้งก้อน — `web/src/` (หน้าจอ), `web/api/` (tRPC routers), `web/db/` (schema, migrations, seed), `web/contracts/` (types/errors ที่แชร์กัน) — ส่วน `desktop/` เป็น Electron shell ที่ห่อ web app

## 3. ขอบเขตงาน (Scope)

### ในระบบ

- ล็อกอินด้วย PIN แยกสิทธิ์ 3 ระดับ (admin / manager / cashier)
- หน้าขาย POS: ขายน้ำมันรวมกับสินค้าอื่น (2T, ของทั่วไป) ในบิลเดียว, ส่วนลด, VAT, เงินทอน, ชำระเงินสด/QR/บัตร/เครดิต
- ขายเชื่อลูกค้าประจำ: วงเงินเครดิต, ยอดค้างชำระ, รับชำระหนี้ (ใบรับชำระเลขที่ P), พิมพ์ใบรับชำระ
- เปิด–ปิดกะ พร้อมจดมิเตอร์ลิตรและมิเตอร์เงิน (P) รายหัวจ่าย เทียบยอดขายกับมิเตอร์
- จัดการสินค้า ตู้จ่าย หัวจ่าย ถังน้ำมัน และการเติมน้ำมันเข้าถัง (+ประวัติเปลี่ยนราคาสินค้า)
- สมาชิกสะสมแต้ม: สมัคร, รับ/ใช้แต้ม, ของรางวัล, ระดับสมาชิก (silver/gold/platinum)
- ลูกค้าและใบกำกับภาษีเต็มรูป (1 บิล = 1 ใบกำกับ)
- ใบกำกับภาษีรองรับกระดาษ A4/A5 และใบเสร็จรองรับ 80/58/A5/A4
- รายงานยอดขาย / แดชบอร์ด / รายงานปิดวัน (Z-report: ยอดแยกวิธีชำระ, ลิตร, กะ, ค่าใช้จ่าย, เงินสดคาดหวัง)
- บันทึกค่าใช้จ่ายหน้าร้าน (ผูกกะอัตโนมัติ)
- Audit log การกระทำสำคัญ (void/แก้/ลบบิล, ปรับแต้ม, เปลี่ยนราคา, จัดการพนักงาน, กู้ฐานข้อมูล ฯลฯ — admin ดู)
- สำรอง/กู้คืนฐานข้อมูลและ Point-in-Time Recovery ผ่าน Supabase ตามแผนบริการ
- ตั้งค่าร้าน (ชื่อ, โลโก้, ที่อยู่ ฯลฯ)
- Desktop responsive สำหรับจอขนาดเล็ก พร้อมเมนูแบบสไลด์และพื้นที่เลื่อนในหน้า/dialog
- Desktop NSIS ตรวจและดาวน์โหลดอัปเดตจาก Google Cloud Storage

### ยังไม่รวม (Out of scope รุ่นแรก)

- การเชื่อมต่อตู้จ่าย/มิเตอร์จริงผ่านฮาร์ดแวร์ (บันทึกมิเตอร์ด้วยมือ)
- ระบบบัญชี/ภาษีแบบเต็ม, e-Tax Invoice ส่งกรมสรรพากร
- การแยกข้อมูลหลายสาขาและสิทธิ์ข้ามองค์กร
- ส่งคำสั่ง ESC/POS โดยตรง (ใช้ Chromium/browser print หรือ silent print ของ Desktop เพื่อรองรับภาษาไทย)

## 4. แผนงานเป็นระยะ (Phases)

### Phase 0 — เตรียมโครงการ ✅

- สร้างโปรเจกต์ Vite + React + TS, ติดตั้ง Tailwind + shadcn/ui
- ติดตั้ง Hono + tRPC ฝั่ง API ใน repo เดียวกัน, เชื่อม Drizzle + MySQL
- ตั้งค่า ESLint/Prettier, `docker-compose.yml`, `.env.example`
- **ผลลัพธ์:** dev server รันได้, เชื่อม DB ได้, โครง repo พร้อม

### Phase 1 — ออกแบบฐานข้อมูล ✅

- ออกแบบ schema: `staff_users`, `products`, `pumps`, `nozzles`, `shifts`, `shift_readings`, `sales`, `sale_items`, `members`, `point_transactions`, `rewards`, `reward_redemptions`, `fuel_tanks`, `tank_refills`, `customers`, `tax_invoices`, `settings`
- สร้าง migration ชุดแรก + seed ข้อมูลตัวอย่าง (ผู้ใช้, สินค้าน้ำมัน, ตู้/หัวจ่าย, ถัง)
- **ผลลัพธ์:** `npm run db:migrate` + seed แล้วมีข้อมูลพร้อมใช้

### Phase 2 — ระบบผู้ใช้และการล็อกอิน ✅

- API `auth.ts`: ล็อกอินด้วย username + PIN (SHA-256), session, guard แยกสิทธิ์
- หน้า `Login.tsx`, `Layout.tsx` (เมนูตามสิทธิ์)
- **ผลลัพธ์:** ล็อกอินได้ 3 บทบาท เมนูตามสิทธิ์

### Phase 3 — หน้าขาย POS ✅

- API `pos.ts`: สร้างบิล, เลขใบเสร็จ, คำนวณ VAT/ส่วนลด/เงินทอน, ตัดสต็อก, void บิล
- หน้า `Pos.tsx` + `ReceiptDoc.tsx` (ใบเสร็จพิมพ์ผ่านเบราว์เซอร์)
- **ผลลัพธ์:** ขายสินค้า/น้ำมัน ออกใบเสร็จได้

### Phase 4 — กะการทำงานและมิเตอร์ ✅

- เปิดกะ: จดมิเตอร์ลิตร + มิเตอร์เงิน P ตั้งต้นรายหัวจ่าย
- ปิดกะ: จดมิเตอร์ปลายกะ คำนวณลิตร/ยอดขายต่อหัวจ่าย เทียบยอด POS กับมิเตอร์
- หน้า `Shifts.tsx`
- **ผลลัพธ์:** เปิด–ปิดกะพร้อมสรุปยอดและส่วนต่างมิเตอร์

### Phase 5 — สต็อก ตู้จ่าย และถังน้ำมัน ✅

- API `catalog.ts`: CRUD สินค้า/ตู้จ่าย/หัวจ่าย, จับคู่หัวจ่ายกับสินค้า
- ถังน้ำมัน: ปริมาณคงเหลือ, จุดแจ้งเตือนต่ำ, บันทึกเติมน้ำมันเข้าถัง (`tank_refills`)
- หน้า `Stock.tsx`
- **ผลลัพธ์:** จัดการสินค้าและระดับน้ำมันในถังได้

### Phase 6 — สมาชิกสะสมแต้ม ✅

- API `membership.ts`: สมัคร/ค้นหาสมาชิก (รหัส/เบอร์), ให้แต้มตามยอดขาย, ใช้แต้ม, แลกของรางวัล, ปรับแต้ม
- หน้า `Members.tsx`, ผูกสมาชิกในหน้าขาย POS
- **ผลลัพธ์:** สมาชิกสะสม–ใช้แต้มได้ครบวงจร

### Phase 7 — ลูกค้าและใบกำกับภาษีเต็มรูป ✅

- API `customers.ts`, `taxInvoice.ts`: ทะเบียนลูกค้า (เลขผู้เสียภาษี, สาขา, ทะเบียนรถ), ออกใบกำกับเต็มรูปจากบิล (1 บิล = 1 ใบ)
- หน้า `Customers.tsx`, `TaxInvoices.tsx`, `TaxInvoiceDialog.tsx`, `TaxInvoiceDoc.tsx`
- **ผลลัพธ์:** ออกใบกำกับภาษีเต็มรูปและพิมพ์ได้

### Phase 8 — รายงานและแดชบอร์ด ✅

- หน้า `Dashboard.tsx`, `Sales.tsx`: ยอดขายวันนี้/ช่วงเวลา, สินค้าขายดี, ประวัติบิล, ยกเลิกบิล
- หน้า `Settings.tsx`: ข้อมูลร้าน, โลโก้, จัดการพนักงาน
- **ผลลัพธ์:** เจ้าของ/ผู้จัดการดูภาพรวมและจัดการระบบได้

### Phase 9 — แพ็กเกจและติดตั้งจริง ✅

- `Dockerfile` + `docker-compose.yml`: container `app` เชื่อม Supabase ผ่าน session pooler
- `web/docker-entrypoint.sh` ตรวจ environment ก่อนเปิด Hono backend; migration ทำแบบส่วนกลางก่อน deploy
- **ผลลัพธ์:** `docker compose up --build` แล้วใช้งานได้ที่ http://localhost:3000

### Phase 10 — เสริมคุณภาพและต่อยอด (กำลังทำ / อนาคต) 🔄

- [x] เพิ่ม unit/integration tests (Vitest) ครอบคลุม logic การขาย/ปิดกะ/แต้ม — integration test ผ่าน tRPC caller ลง PGlite PostgreSQL ชั่วคราว: `web/api/test/testDb.ts`, `pos.sale.test.ts`, `pos.shift.test.ts`, `membership.test.ts`
- [x] ~~ใบเสร็จความร้อน (ESC/POS)~~ → **ถอดออกแล้ว** — เครื่อง Gainscha GA-E200I ไม่มีฟอนต์ไทยใน firmware พิมพ์ไทยไม่ได้ ตัดสินใจใช้พิมพ์ผ่านเบราว์เซอร์อย่างเดียว (ลบ router `printer` + `web/api/lib/escpos.ts`/`printerTransport.ts`/`receiptPrint.ts` + hook `useThermalPrint`); เหลือตั้งได้แค่ขนาดกระดาษใบเสร็จ (80/58/A5/A4 — setting `receipt_paper_size`, `printReceiptElement` ใน `web/src/lib/printDoc.ts`)
- [x] พิมพ์ใบเสร็จเงียบอัตโนมัติหลังชำระเงิน (desktop) — IPC `print:silent` (`desktop/electron/main.ts`) เปิดหน้าต่างซ่อน render HTML ใบเสร็จด้วย Chromium แล้ว `webContents.print({ silent: true })` เข้าเครื่องพิมพ์ default ของ Windows — ภาษาไทยถูกเสมอ ไม่ต้องมีฟอนต์ไทยในเครื่องพิมพ์ ไม่เด้ง dialog; ตั้งค่า `receipt_silent_print` ในหน้า Settings (ใช้ขนาดกระดาษจาก `receipt_paper_size`), helper `printReceiptSilent` ใน `web/src/lib/printDoc.ts`
- [x] ขายเชื่อ/ลูกค้าเครดิต — paymentMethod "credit" + `sales.customer_id`, ตาราง `debt_payments`, router `credit` (ยอดค้าง/รับชำระ/วงเงิน), หน้า `/debts` + ใบรับชำระ (เลข P), ใบเสร็จแสดงชื่อลูกค้าเครดิต
- [x] รายงานปิดวัน (Z-report) — `reports.daily` (ยอดแยกวิธีชำระ/ลิตร/กะ/ค่าใช้จ่าย/รับชำระหนี้/เงินสดคาดหวัง), หน้า `/reports` + พิมพ์ผ่านเบราว์เซอร์
- [x] บันทึกค่าใช้จ่ายหน้าร้าน — ตาราง `expenses`, router `expenses` (ผูกกะอัตโนมัติ), หน้า `/expenses`
- [x] ประวัติเปลี่ยนราคาสินค้า — ตาราง `price_changes`, hook ใน `catalog.updateProduct`, ดูประวัติจากปุ่มในหน้า Settings
- [x] Audit log — ตาราง `audit_logs` + `web/api/lib/audit.ts` ผูก mutation สำคัญ (void/แก้/ลบบิล, ปรับแต้ม, เปลี่ยนราคา, พนักงาน, กู้ db, ค่าใช้จ่าย, ชำระหนี้), หน้า `/audit` เฉพาะ admin
- [x] ระบบสำรองสองชั้นใน `2.0.0` — Supabase Pro Daily Backup 7 วัน + Logical Backup ทุก 6 ชั่วโมงไป Private GCS, แสดงสถานะ/ดาวน์โหลดจาก Settings และบังคับ Restore ผ่านฐานทดสอบ
- [x] ส่งออกรายงาน Excel/PDF, รายงานกำไรต่อลิตร — `reports.exportDailyExcel`/`exportRangeExcel` (exceljs ฝั่ง server ส่ง base64, หน้า `/reports` ปุ่มส่งออกรายวัน+ช่วงเวลา ≤92 วัน, เฉพาะ admin/manager), `reports.fuelProfit` + ตารางกำไรต่อลิตรบนหน้าเว็บ; PDF ใช้ปุ่มพิมพ์เดิม → Save as PDF ของเบราว์เซอร์
- [x] แจ้งเตือนน้ำมันใกล้หมดถังหน้าแดชบอร์ดแบบเรียลไทม์ — `catalog.lowStockAlerts` (ถังต่ำกว่า `low_alert_at` + สินค้าต่ำกว่า `low_stock_at`), กระดิ่ง `LowStockAlert.tsx` ใน Layout ทุกหน้า โพล 15 วิ แสดง badge + popover รายการ, เด้ง toast (sonner) ทันทีเมื่อมีรายการใหม่ต่ำกว่าเกณฑ์, การ์ดเตือนเดิมบนหน้าแดชบอร์ดคงไว้
- [x] นับเงินลิ้นชักครบวงจร — เงินทอนเริ่มกะ (`shifts.opening_float`), นับเงินสดแยกแบงก์/เหรียญตอนปิดกะ (`shifts.cash_counts` JSON — เซิร์ฟเวอร์รวมยอดเองจาก `web/contracts/cash.ts`), snapshot เงินสดควรมีลงกะ (`shifts.expected_cash` = เงินทอน+ขายสด+ชำระหนี้สด−ค่าใช้จ่าย คำนวณโดย `web/api/lib/cash.ts`), `debt_payments.shift_id` ผูกกะอัตโนมัติแบบค่าใช้จ่าย, แสดงส่วนต่างเงินสด (ขาด/เกิน) ในหน้าปิดกะแบบเรียลไทม์ + ประวัติกะ + Z-report + Excel, audit log `close_shift` ตอนปิดกะ
- [x] ใช้ migration ส่วนกลางผ่าน `DIRECT_URL` (session pooler) และห้าม `db:push` กับ production
- [x] เปลี่ยน multi-station จาก LAN เป็นระบบกลางใน `2.0.0` — ทุกเครื่องใช้ Vercel/Railway/Supabase ชุดเดียวกันและยืนยันสิทธิ์ด้วย signed staff session
- [x] แก้หน้า Settings โหลดข้อมูลครั้งแรก/หลังสลับเมนู และ refresh ค่าล่าสุดหลังบันทึก เพื่อไม่แสดงฟอร์มว่างหรือค่าค้าง
- [x] เพิ่มการตั้งค่ากระดาษใบกำกับภาษี A4/A5 พร้อมปรับ preview และ print layout
- [x] ปรับ Desktop ให้ responsive บนจอขนาดเล็ก ปรับขนาดหน้าต่างเริ่มต้นตาม work area และให้หน้า/dialog เลื่อนด้วยล้อเมาส์ได้
- [x] UX/UI Station Console (`1.0.20`) — design tokens/component กลาง, navigation แบ่งกลุ่ม, สถานะกะ, Login/Dashboard/POS ใหม่, touch target ใหญ่ขึ้น, safe-area mobile, bottom navigation และ mobile cart sheet
- [x] พนักงานและตารางงาน (workforce) — ตาราง `work_shift_templates`/`work_schedules`/`employee_profiles`/`payroll_records` (migration 0007), router `workforce` (admin จัดการแม่แบบกะ/ตารางเวร/สลับเวร/โปรไฟล์/เงินเดือน พนักงานดูของตัวเองผ่าน `myProfile`/`myPayroll`), หน้า `/workforce` เมนู "พนักงานและตารางงาน"
- [x] admin จัดการประวัติตัดกะ — `pos.shiftHistory`/`createShiftHistory`/`updateShiftHistory`/`deleteShiftHistory` (เฉพาะ admin) เพิ่ม/แก้/ลบประวัติตัดกะย้อนหลังพร้อมมิเตอร์รายหัวจ่าย บันทึก audit log ทุก action
- [x] เอกสารลูกค้าเครดิต A4 (`1.0.20`) — ใบขอเปิดบัญชีเครดิตและรายการรถบรรทุก/เครื่องจักร พร้อม preview/print จากเมนูเอกสาร; จำกัดผู้ใช้ admin/manager และจำกัดการรับชำระหนี้ให้ผู้จัดการขึ้นไป
- [ ] เชื่อมตู้จ่าย/มิเตอร์จริง (ถ้ามีฮาร์ดแวร์รองรับ)
- [ ] คู่มือใช้งานสำหรับพนักงาน

### Phase 11 — Desktop App (.exe) ✅

- แปลงเป็น Desktop App ด้วย Electron; รุ่น `2.0.0` เปลี่ยนเป็น shell ที่โหลดเว็บกลางและไม่เก็บ database secret ในเครื่องลูก
- ตั้งแต่ `1.0.18` ใช้ Google Cloud Storage เป็นแหล่ง Auto Update และมี `npm run publish:gcs` สำหรับเผยแพร่ไฟล์
- รายละเอียดเต็มอยู่ในเอกสารแยก: [`plan-desktop.md`](./plan-desktop.md)

### Phase 12 — ความพร้อมใช้งานจริงและการส่งมอบ 🔄

- [x] Build และเผยแพร่ installer/Portable ของ `1.0.18` ไป `gs://kimi-agent-pos-updates`
- [x] Build และเผยแพร่ installer/Portable ของ `1.0.20` ไป GCS พร้อมตรวจ HTTP 200, Content-Length, cache policy และ HTTP range
- [x] Deploy เว็บออนไลน์ — frontend บน Vercel (`kimi-agent-pos.vercel.app`) rewrite `/api/*` ไป backend Docker บน Railway ซึ่งเชื่อม Supabase PostgreSQL
- [x] สร้าง NSIS Wizard ภาษาไทยพร้อม EULA/โลโก้ KY และติดตั้งสำหรับผู้ใช้ทุกคนใน `Program Files` (`1.0.21`, build ในเครื่อง)
- [x] ตรวจ public URL, ขนาดไฟล์, SHA metadata และการรองรับ HTTP range
- [x] ย้าย updater configuration จาก GitHub Releases ไป GCS generic provider
- [ ] ทำ bridge ให้เครื่อง `1.0.17` และเก่ากว่าได้รับ `1.0.18` หรือให้ติดตั้ง `1.0.18` ด้วยมือหนึ่งครั้ง
- [ ] ทดสอบ Auto Update จาก `1.0.20` ไปเวอร์ชันถัดไปแบบ end-to-end
- [ ] ทดสอบ NSIS installer, การพิมพ์, อินเทอร์เน็ตหลุด/กลับมา และเปิดใช้งานข้ามวันบนเครื่องปั๊มจริง
- [ ] จัดทำคู่มือพนักงานและคู่มือผู้ดูแลระบบ
- [x] เพิ่ม Code Signing สำหรับ Windows installer — ทำใน `1.0.24` แบบ self-signed (รายละเอียด `plan-desktop.md` D17)

## 5. การทดสอบและยอมรับ (Acceptance)

- `npm run check` (tsc) และ `npm run lint` ผ่านก่อนทุก phase
- `npm run test` (Vitest) สำหรับ logic สำคัญ
- ทดสอบ end-to-end ด้วยมือบน Docker ตามสถานการณ์หลัก: ล็อกอิน → เปิดกะ → ขาย → ใช้แต้ม → ปิดกะ → ออกใบกำกับ → ดูรายงาน
- ทดสอบ Desktop เพิ่ม: Settings โหลด/บันทึก/สลับเมนู, จอขนาดเล็ก, A4/A5, silent print, backup/restore และ Auto Update

## 6. การติดตั้งและส่งมอบ

- ช่องทางหลัก: NSIS installer; ช่องทางพกพา: Portable `.exe`; ช่องทาง Web: `docker compose up --build` หรือ Web ออนไลน์ Vercel + Railway (PROJECT.md หัวข้อ 11)
- ไฟล์อัปเดต Desktop รุ่น `1.0.18` เป็นต้นไปเผยแพร่ที่ `gs://kimi-agent-pos-updates`
- บัญชีเริ่มต้นจาก seed: `admin`/`1234`, `manager`/`2222`, `somchai`/`0000` (เปลี่ยนหลังติดตั้ง)
- ข้อมูลอยู่ใน Supabase private schema `pos`; backend เก็บ connection secret ใน Railway และปรับค่าผ่าน environment variables

## 7. ความเสี่ยงและแนวทางรับมือ

| ความเสี่ยง                         | แนวทางรับมือ                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| การเปลี่ยน schema ทำข้อมูลเดิมเสีย | ใช้ migrations เท่านั้น (ห้าม `db:push`), commit ไฟล์ migration เข้า git                                                               |
| มิเตอร์จดผิด                       | ตรวจยอดส่วนต่างตอนปิดกะ + ช่อง note อธิบาย                                                                                             |
| ข้อมูลหาย                          | Supabase Daily Backup, Private GCS 6 ชั่วโมง, restore drill รายเดือน, migration history และเก็บ SQLite ต้นทางไว้ตรวจสอบช่วงเปลี่ยนผ่าน |
| PIN รั่วไหล                        | เก็บ hash เท่านั้น, บังคับเปลี่ยน PIN เริ่มต้น, ตั้ง `APP_SECRET` เอง                                                                  |
| เน็ต/ไฟดับที่ปั๊ม                  | รุ่น `2.0.0` ต้องใช้อินเทอร์เน็ต; เตรียมลิงก์สำรอง/UPS และขั้นตอนหยุดขายชั่วคราว                                                       |
| รุ่นเก่ายังชี้ GitHub updater      | ติดตั้ง `1.0.18` ด้วยมือหรือทำ GitHub bridge release หนึ่งครั้ง                                                                        |
| GCS ใช้ไม่ได้                      | updater บันทึก error และลองใหม่เมื่อเปิดแอปครั้งถัดไป; เว็บหลักยังทำงานได้                                                             |
| Windows SmartScreen เตือน          | วางแผน Code Signing; ก่อนมี certificate ให้ตรวจ checksum และแหล่งดาวน์โหลดทุกครั้ง                                                     |

---

_สถานะ ณ 22 กรกฎาคม 2026: รุ่น 2.0.4 ใช้ฐานข้อมูลกลาง Supabase PostgreSQL, deploy Vercel/Railway Singapore, มี Private GCS Backup และ Offline-first Desktop Sales พร้อม durable outbox/idempotent sync, Modern Command Center, การลากเรียงถังแบบบันทึกถาวร และการคำนวณลิตร 3 ตำแหน่งแล้ว ส่วนงานคงเหลือคือการตรวจรับบนเครื่องหน้างานและทดสอบ auto-update แบบ end-to-end_
