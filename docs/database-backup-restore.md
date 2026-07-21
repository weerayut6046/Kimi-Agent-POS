# คู่มือสำรองและกู้คืนฐานข้อมูล

ระบบใช้การสำรองข้อมูลสองชั้นเพื่อไม่ให้ฐานข้อมูล production และไฟล์สำรองอยู่กับผู้ให้บริการรายเดียวกัน

## ชั้นการสำรองข้อมูล

1. **Supabase Pro Daily Backup** — Supabase สำรองฐานข้อมูลทุกวันและเก็บจุดกู้คืนย้อนหลัง 7 วัน จัดการจาก `Database > Backups` ใน Supabase Dashboard
2. **Private GCS Logical Backup** — Railway ใช้ `pg_dump 17` สำรอง private schema `pos` เป็น PostgreSQL custom archive ทุก 6 ชั่วโมง แล้วอัปโหลดไป bucket `kimi-agent-pos-db-backups-838443043443` ที่ Tokyo (`ASIA-NORTHEAST1`)

Private GCS ใช้กติกาดังนี้

- Public Access Prevention: `enforced`
- Uniform bucket-level access: เปิด
- ชุด `scheduled/` และ `manual/`: ลบด้วย lifecycle เมื่ออายุ 35 วัน
- ชุด `monthly/`: สร้างจาก Backup อัตโนมัติชุดแรกของวันที่ 1 และเก็บ 370 วัน
- GCS soft delete: 7 วันหลัง lifecycle ลบ object
- ทุกไฟล์มี manifest `.json`, SHA-256 และผ่าน `pg_restore --list` ก่อนอัปโหลด

Cloud Scheduler job ชื่อ `kimi-agent-pos-database-backup` ทำงานด้วย cron `0 */6 * * *` ใน timezone `Asia/Bangkok` และเรียก Railway endpoint `/api/internal/database-backup` ด้วย secret ที่เก็บแยกจาก source code

## การใช้งานประจำวัน

ผู้ดูแลระบบเปิด `Settings > ฐานข้อมูลและการสำรองข้อมูล` เพื่อ:

- ดูสถานะ Supabase Backup และ Private GCS
- ดูประวัติไฟล์สำรองล่าสุด ขนาด และ SHA-256
- กด `สำรองข้อมูลตอนนี้` เพื่อสร้างชุด `manual/`
- ดาวน์โหลดผ่าน signed URL ที่หมดอายุภายใน 15 นาที
- เปิดหน้า Supabase Backups

ไม่เปิดให้ลบหรือ Restore ฐาน production ผ่านหน้าแอป การลบทำด้วย GCS lifecycle และการกู้คืนต้องผ่านขั้นตอนทดสอบด้านล่าง

## ตรวจสอบเมื่อ Backup ไม่ทำงาน

1. เปิด Google Cloud Scheduler และตรวจ job `kimi-agent-pos-database-backup`
2. ตรวจ Railway logs ของ service `api` โดยค้นหา `สำรองฐานข้อมูลตามเวลาไม่สำเร็จ`
3. ตรวจว่าตัวแปรต่อไปนี้ยังอยู่ใน Railway โดยห้ามพิมพ์ค่าของ secret ลง log:
   - `SUPABASE_PROJECT_REF`
   - `GCS_BACKUP_PROJECT_ID`
   - `GCS_BACKUP_BUCKET`
   - `GCS_BACKUP_CREDENTIALS_BASE64`
   - `BACKUP_CRON_SECRET`
4. ตรวจว่า service account `pos-backup-writer@kimi-agent-pos.iam.gserviceaccount.com` มีเพียงสิทธิ์ `roles/storage.objectCreator` และ `roles/storage.objectViewer` บน bucket สำรอง (ไม่มีสิทธิ์ลบ)
5. สั่ง Run now จาก Cloud Scheduler แล้วตรวจว่ามี `.dump` และ `.dump.json` คู่ใหม่ใน GCS

## Restore drill รายเดือน

ทำขั้นตอนนี้กับ Supabase project ทดสอบเท่านั้น ห้ามใช้ `DATABASE_URL` ของ production เป็นเป้าหมาย

1. ดาวน์โหลด `.dump` ล่าสุดจากหน้า Settings
2. อ่านไฟล์ manifest `.json` จาก GCS และตรวจ SHA-256 ของไฟล์ที่ดาวน์โหลด
3. สร้าง Supabase project ทดสอบใน region ที่ต้องการ
4. คัดลอก Session pooler URL พอร์ต `5432` ของ project ทดสอบ
5. ใช้ PostgreSQL client รุ่น 17 กู้คืน:

```powershell
$env:TARGET_DATABASE_URL = "postgresql://postgres.<TEST-REF>:[URL_ENCODED_PASSWORD]@<SESSION_POOLER>:5432/postgres"
pg_restore --single-transaction --no-owner --no-privileges --dbname="$env:TARGET_DATABASE_URL" .\kimi-agent-pos-pos-<TIMESTAMP>.dump
```

6. ตรวจตารางและจำนวนข้อมูลสำคัญ:

```sql
select count(*) from pos.staff_users;
select count(*) from pos.products;
select count(*) from pos.sales;
select count(*) from pos.sale_items;
select count(*) from pos.shifts;
select count(*) from pos.audit_logs;
```

7. ชี้ backend ทดสอบไปยัง project ทดสอบ แล้วทดสอบ Login, Dashboard, เปิดกะ, การขาย, รายงาน และใบกำกับภาษี
8. บันทึกวันทดสอบ ไฟล์ที่ใช้ SHA-256 ผลตรวจ และผู้ทดสอบ
9. ลบ project ทดสอบเมื่อไม่ใช้งาน เพื่อลดค่าใช้จ่าย

## การกู้คืนเมื่อเกิดเหตุจริง

เลือกวิธีตามเหตุการณ์:

- ต้องย้อนข้อมูลไม่เกิน 7 วันและ Supabase project เดิมยังใช้งานได้: ใช้ Supabase Dashboard Backup โดยเตรียม downtime
- ต้องตรวจข้อมูลก่อนตัดสินใจ: Restore Backup ไปยัง Supabase project ใหม่ แล้วตรวจสอบก่อนสลับระบบ
- ต้องใช้ไฟล์นอก Supabase: ใช้ `.dump` จาก Private GCS และทำตาม Restore drill

หลังตรวจสอบ project ใหม่แล้วจึงเปลี่ยน `DATABASE_URL` และ `SUPABASE_PROJECT_REF` บน Railway, deploy backend ใหม่, ทดสอบ health/API และค่อยเปิดให้สถานีขายต่อ ห้ามเขียนข้อมูลพร้อมกันทั้งฐานเดิมและฐานใหม่

## การหมุนกุญแจ

หมุน service-account key และ `BACKUP_CRON_SECRET` อย่างน้อยปีละครั้งหรือทันทีเมื่อสงสัยว่ารั่วไหล โดยตั้งค่าชุดใหม่ใน Railway/Cloud Scheduler และทดสอบ Backup ให้สำเร็จก่อนลบ key เก่า ต้องไม่ commit service-account JSON, connection string หรือ scheduler secret ลง Git
