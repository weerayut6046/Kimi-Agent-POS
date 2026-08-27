# Storage and restore drill plan

ฐานข้อมูลธุรกิจสำรองเป็นไฟล์ `.posbackup` จากหน้า admin โดยตรง ไฟล์ถูกดาวน์โหลด
ไปยังเครื่องผู้ดูแลและไม่ถูกเก็บใน Supabase Storage ดูขั้นตอนสำรองและกู้คืนที่
[`database-backup-restore.md`](./database-backup-restore.md)

ไฟล์ฐานข้อมูลไม่รวม bytes ของไฟล์ใน Storage และไม่รวม configuration ของ Auth,
Edge Functions, Realtime, extensions, webhooks หรือ cron จึงต้องสำรองส่วนเหล่านี้แยก
ตาม [`supabase-storage-config-backup.md`](./supabase-storage-config-backup.md)

## Checklist รายเดือน

- ดาวน์โหลด `.posbackup` ใหม่และคัดลอกไปยังสื่อที่เข้ารหัสอย่างน้อยอีกหนึ่งแห่ง
- กู้คืนไฟล์ในสภาพแวดล้อมทดสอบและตรวจ Login, Dashboard, กะ, ยอดขาย, สต๊อก,
  สมาชิก, ลูกหนี้ และ Audit log
- ตรวจว่าไฟล์รูปตัวอย่างจาก Storage เปิดได้และ checksum ตรงกับ manifest
- ตรวจ configuration inventory ของ Auth, Edge Functions, Realtime, extensions,
  webhooks และ cron
- บันทึกวันเวลา ผู้ทดสอบ ระยะเวลากู้คืน และปัญหาที่พบ

ก่อนกู้คืน production ต้องหยุด write traffic ดาวน์โหลดไฟล์สำรองสถานะปัจจุบัน
และเตรียม rollback plan เสมอ
