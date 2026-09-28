# Local / Self-hosted development

โหมดนี้ใช้ PostgreSQL บนเครื่องนักพัฒนาหรือเซิร์ฟเวอร์ส่วนตัว และไม่เรียก Cloud SQL, Supabase Database, Supabase Auth หรือ Supabase Realtime ระหว่างพัฒนา ตัวแอปยังใช้ schema และ migration ชุดเดียวกับ production จึงย้ายขึ้น hosting ภายหลังได้โดยเปลี่ยน environment variables เท่านั้น

## เริ่มใช้งานบนเครื่องเดียว

หากต้องการเลือกและเตรียมฐานข้อมูลผ่านฟอร์ม ให้รัน `npm run setup:system` ตัวช่วยเปิดเฉพาะบนเครื่องเซิร์ฟเวอร์ รองรับ Supabase และ PostgreSQL ในเครื่อง ดู [ตัวช่วยติดตั้งระบบ](./system-installation.md)

ต้องติดตั้ง Node.js, npm และ Docker Desktop/Engine ก่อน จากนั้นรัน:

```bash
copy .env.local.example .env.local
npm run dev:local
```

## ข้อมูลทดลองในโหมด Dev

ฐานติดตั้งใหม่เตรียมสินค้าและอุปกรณ์ตั้งต้น พร้อมสถานะรอสร้างเจ้าของ ไม่เพิ่มบิล กะ หรือพนักงานทดลองอัตโนมัติ เมื่อเปิดเว็บจะไป `/setup` เพื่อกำหนดชื่อผู้ใช้และ PIN ตัวเลข 4–6 หลัก แล้วตั้งค่ากิจการ

หากต้องการข้อมูลย้อนหลัง 7 วันสำหรับทดสอบ dashboard และรายงาน หลังสร้างเจ้าของแล้วหยุด dev server และเปิดใหม่พร้อม `--demo`:

```bash
npm run dev:local -- --demo
```

ตัว runner ใช้ค่าเชื่อมต่อและ secret ชุดเดียวกับแอปให้ ข้อมูลทดลองใช้รหัสหรือหมายเหตุ `DEV-` / `DEV-DEMO` และทำงานเฉพาะ Local Auth ใน non-production ฐานเก่าที่ไม่มีสถานะติดตั้งรุ่นใหม่ยังคงพฤติกรรม seed demo เดิม

บัญชีทดสอบสิทธิ์พนักงาน:

- ผู้จัดการที่สร้างใหม่: `devmanager` / PIN `6381`
- แคชเชียร์ที่สร้างใหม่: `devcashier` / PIN `2048`

Seed นี้รันซ้ำได้โดยไม่เพิ่มรายการเดิมซ้ำ ไม่แก้ทับบัญชีทดลองที่มีอยู่แล้ว และถูกล็อกให้ทำงานเฉพาะ Local Auth ใน non-production เท่านั้น หากล้างฐานด้วย `npm run db:local:reset` ข้อมูลทั้งหมดจะถูกสร้างใหม่เมื่อรัน `npm run dev:local` ครั้งถัดไป

บน macOS/Linux ใช้ `cp` แทน `copy` คำสั่งจะเปิด PostgreSQL ที่ `127.0.0.1:54329`, รัน migration, seed ข้อมูลเมื่อฐานยังว่าง และเปิดเว็บที่ `http://127.0.0.1:3010`

บน Windows หากติดตั้ง Docker Desktop แล้วแต่ Engine ยังปิดอยู่ ตัว runner จะเปิด Docker Desktop และรอจนพร้อมให้อัตโนมัติ หากเปิดไม่สำเร็จภายใน 60 วินาทีจะแจ้งให้ตรวจสถานะใน Docker Desktop

ถ้าพอร์ต 3010 ถูกใช้งานอยู่ ให้เปลี่ยน `LOCAL_APP_PORT` ใน `.env.local` เช่น `LOCAL_APP_PORT=3011`

ชุดติดตั้งใหม่ไม่มี PIN เจ้าของตั้งต้น ให้สร้างบัญชีจาก `/setup` ข้อมูล PostgreSQL อยู่ใน Docker volume จึงยังอยู่หลังหยุด container

เมื่อรันด้วย Vite development server (`npm run dev`, `npm run dev:local` หรือ `npm run dev:self-hosted`) การเข้าสู่ระบบใช้ชื่อผู้ใช้และ PIN โดยไม่ต้องสแกนใบหน้า เพื่อให้พัฒนาและทดสอบได้โดยไม่ต้องใช้กล้อง Vite development mode จะใช้ local API และ session ที่เซ็นด้วย `APP_SECRET` แม้ตั้ง `VITE_USE_SUPABASE_EDGE_API=true` ไว้ เพื่อไม่ส่งคำสั่งข้าม biometric ไปยัง production Edge API การข้ามขั้นตอนนี้ตรวจจาก runtime ฝั่ง API และไม่ทำงานใน production build หรือ Supabase Edge Runtime

## เปิดให้เครื่องอื่นใน LAN

```bash
npm run dev:self-hosted
```

ตัวเว็บจะ bind ที่ `0.0.0.0` ตาม `LOCAL_APP_PORT` แต่พอร์ต PostgreSQL ยัง bind เฉพาะ `127.0.0.1` เพื่อไม่เปิดฐานข้อมูลตรงให้เครื่องอื่น ใช้เฉพาะ LAN ที่เชื่อถือได้และตั้ง `LOCAL_APP_SECRET` และ `LOCAL_POSTGRES_PASSWORD` ใหม่เสมอ

ถ้า PostgreSQL อยู่บนเซิร์ฟเวอร์ส่วนตัวอีกเครื่อง ให้กำหนด `LOCAL_DATABASE_URL` ใน `.env.local` ตัว runner จะข้าม Docker database และรัน migration/seed ไปยัง URL นั้นโดยตรง ฐานปลายทางต้องมี role `anon` และ `authenticated` แบบ `NOLOGIN` เพื่อรองรับ migration ชุดเดียวกับ production (ดู `ops/postgres/init-local.sql`)

## คำสั่งดูแลฐานข้อมูล

```bash
npm run db:local:up       # เปิดเฉพาะ PostgreSQL
npm run db:local:down     # ปิด โดยเก็บข้อมูลไว้
npm run db:local:reset    # ลบ container และ volume ข้อมูลทั้งหมด
```

`db:local:reset` ลบข้อมูล dev แบบกู้กลับไม่ได้ หากต้องการเก็บข้อมูลให้ใช้ `db:local:down`

## ขอบเขตด้านความปลอดภัย

- Local Auth เปิดได้เฉพาะเมื่อ runtime ไม่ใช่ production และ `LOCAL_AUTH_ENABLED=true`
- การข้ามการสแกนใบหน้าเปิดเฉพาะเมื่อ `NODE_ENV=development`; production ยังคงบังคับ PIN และใบหน้า
- PIN ของบัญชีใหม่เก็บด้วย HMAC ที่ใช้ `APP_SECRET`; บัญชี local รุ่นเก่ายังรองรับ salted scrypt; session หมดอายุภายใน 12 ชั่วโมงและเซ็นด้วย `APP_SECRET`
- role `anon` และ `authenticated` ใน PostgreSQL local เป็น `NOLOGIN` และมีไว้เพื่อให้ migration production ชุดเดิมทำงานได้เท่านั้น
- ห้ามนำค่าใน `.env.local` ขึ้น Git หรือใช้เป็น production secrets

## ย้ายขึ้น hosting จริง

1. สร้าง PostgreSQL/Supabase production และใช้ migration ใน `web/db/migrations-postgres/`
2. ตั้ง `DATABASE_URL`/`DIRECT_URL` ของ production โดยไม่ตั้ง `LOCAL_AUTH_ENABLED`
3. ตั้ง Supabase Auth variables ฝั่ง server และ `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` ฝั่ง frontend
4. รัน `npm run check`, `npm test`, migration และทดสอบ login/ขาย/ปิดกะก่อน cutover
5. ย้ายเฉพาะข้อมูลที่ต้องการด้วยกระบวนการ backup/restore; อย่าคัดลอก secrets จาก dev

Production flow เดิมจึงไม่เปลี่ยน และ local mode ไม่สามารถเปิดโดยบังเอิญเมื่อ `NODE_ENV=production`
