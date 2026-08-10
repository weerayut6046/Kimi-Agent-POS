# Storage and restore drill plan

แผนเดิมสำหรับ logical backup จาก backend ภายนอกถูกยกเลิกหลังย้าย backend ไป
Supabase Edge Functions แล้ว Production ใช้ Supabase Managed Backups และทำ
restore drill ตาม [`database-backup-restore.md`](./database-backup-restore.md)

Database Backup ไม่รวม bytes ของไฟล์ใน Supabase Storage และ Restore-to-New-Project
ไม่คัดลอกการตั้งค่าระบบทั้งหมด จึงต้องทำแผน Storage/config แยกตาม
[`supabase-storage-config-backup.md`](./supabase-storage-config-backup.md)

ก่อนปิดระบบ backend เดิม ต้องยืนยันว่า:

- Scheduled Backup/PITR ตามแผนบริการทำงาน
- เคย restore ไป project แยกและผ่าน data-integrity checks
- ผู้ดูแลเปิด MFA และจำกัดสิทธิ์ Dashboard
- Edge Functions ไม่มี database/service-role secrets ใน client หรือ log
- มีขั้นตอนหยุด write traffic และสลับ project configuration ที่ทดสอบแล้ว
- มีสำเนา Storage objects นอก Supabase พร้อม manifest/checksum และเคยทดสอบเปิดไฟล์ตัวอย่าง
- มี configuration inventory ของ Auth, Edge Functions, Realtime, extensions, webhooks และ cron
