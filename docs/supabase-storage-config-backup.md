# Supabase Storage and configuration backup

Supabase Database Backup เก็บ metadata ใน PostgreSQL แต่ไม่เก็บ bytes ของ Storage
objects และ Restore-to-New-Project ต้องตั้งค่าบางส่วนใหม่ เอกสารนี้เป็น checklist สำหรับ
สำเนานอก Supabase โดยไม่เก็บ secret ลง Git, log หรือไฟล์หลักฐาน

## Storage objects

1. เปิด S3 protocol ของ Supabase Storage และสร้าง credentials สำหรับงาน backup โดยเฉพาะ
2. ใช้ S3-compatible client เช่น `rclone` คัดลอกทุก bucket ไป private bucket คนละ
   cloud account/project กับ production
3. เปิด encryption, object versioning และ retention policy/Bucket Lock ที่ปลายทาง
4. สร้าง manifest ต่อรอบอย่างน้อย: bucket, object key, size, modified time และ checksum
5. แจ้งเตือนเมื่อรอบสำรองล้มเหลว, จำนวนไฟล์ลดลงผิดปกติ หรือไม่มี manifest ใหม่เกิน SLA
6. ทุก 90 วันให้ restore ไฟล์ตัวอย่างหลายชนิดและตรวจว่าเปิดใช้งานได้จริง

ห้ามใส่ S3 access key/secret ใน browser, repository หรือหน้าจอ Settings ให้เก็บใน
Secret Manager ของ backup worker และจำกัดสิทธิ์เฉพาะ bucket ที่ต้องอ่าน

## Configuration inventory

เก็บรายการต่อไปนี้พร้อมวันที่ตรวจและผู้ตรวจ โดยไม่บันทึก secret value:

- Edge Functions source/deployed version และรายการชื่อ secret ที่ต้องสร้างใหม่
- Auth providers, redirect URLs, password/session policy และ email/SMS templates
- Realtime publications/settings
- PostgreSQL extensions/settings, cron jobs, webhooks, replication slots และ read replicas
- Storage buckets, public/private flag, size limits, MIME rules และ access policies
- Project region, compute/disk attributes, SSL enforcement และ network restrictions
- Deployment configuration ที่ต้องสลับเมื่อย้าย project เช่น Edge/Vercel/Desktop origin

Migration, Edge Function source และ `supabase/config.toml` ต้องอยู่ใน version control
ส่วน API keys/passwords ให้เก็บใน Secret Manager และทดสอบขั้นตอนสร้างใหม่ตาม runbook

## Restore drill acceptance

- Restore Database ลง project ใหม่เท่านั้นและปิด external cron/webhook ก่อนทดสอบ mutation
- Restore Storage objects พร้อมตรวจ manifest/checksum
- ตั้ง Auth, Edge Functions, Realtime และ integrations จาก inventory
- ตรวจ Login, Dashboard, กะ, รายการขาย, สต๊อก, เครดิต, เอกสารภาษี และ audit log
- บันทึก RPO/RTO จริงใน Settings และลบ project ทดสอบหลังเก็บหลักฐานครบ
