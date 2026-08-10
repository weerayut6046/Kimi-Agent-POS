# Database backup and restore runbook

Production ใช้ Supabase Managed Backups เป็นระบบสำรองข้อมูลหลัก หน้า Settings
แสดง Backup Health และลิงก์ไป Supabase Dashboard แต่ไม่รับคำสั่งสร้าง ดาวน์โหลด ลบ
หรือ restore ฐานข้อมูลจาก Edge runtime หากตั้งค่า
`PUMPPOS_MANAGEMENT_ACCESS_TOKEN` ต้องใช้ fine-grained token ที่มีเฉพาะสิทธิ์
`backups_read` ระบบจะอ่านสถานะผ่าน Management API และไม่ส่ง token ไป browser

Node backend เดิมรองรับ Logical Backup ไป Private GCS แต่ Edge runtime ไม่รองรับ
`pg_dump` จึงต้องใช้ worker ภายนอก Edge หากต้องการเปิด off-site logical backup อีกครั้ง

## Backup policy

- เปิด Scheduled Backups ตามแผน Supabase ของ project
- เปิด Point-in-Time Recovery เมื่อ RPO/RTO ของธุรกิจกำหนดให้ต้องใช้
- จำกัดสิทธิ์ Dashboard และ database credentials เฉพาะผู้ดูแลที่จำเป็น
- เปิด MFA ให้บัญชีผู้ดูแล Supabase ทุกบัญชี
- ตรวจ backup status อย่างน้อยทุกวัน และทำ restore drill ทุก 90 วัน
- Backup Health ต้องแจ้งเตือนเมื่อ daily backup ล่าสุดเกิน 36 ชั่วโมงหรือสถานะไม่สำเร็จ
- บันทึกผล Restore Drill, project ทดสอบ, restore point, checklist, RPO และ RTO ในหน้า Settings
- สำรอง Supabase Storage objects และ configuration inventory แยกจาก Database Backup
  ตาม [`supabase-storage-config-backup.md`](./supabase-storage-config-backup.md)

## Restore drill

1. เลือก backup/restore point จาก Supabase Dashboard
2. Restore ไป project ทดสอบหรือ project ใหม่ ห้ามทับ production เพื่อการซ้อม
3. ใช้บัญชีทดสอบตรวจจำนวนตาราง ข้อมูลกะ ยอดขาย สต๊อก ลูกหนี้ เอกสารภาษี และ
   audit log
4. รัน smoke test แบบ read-only ก่อน แล้วจึงทดสอบ mutation กับสำเนา
5. บันทึกเวลา restore, RPO, RTO, ผู้ดำเนินการ และผลตรวจ
6. ลบ project ทดสอบตามนโยบาย retention เมื่อหลักฐานการซ้อมครบ

หน้า Settings > ฐานข้อมูล > บันทึกผลซ้อมกู้คืน ใช้เก็บหลักฐานต่อสาขา ผล “ผ่าน”
ต้องตรวจ Login, Dashboard, กะ, รายการขาย, สต๊อก, เครดิต และ audit log ครบทุกข้อ

## Production recovery

เมื่อ production เสียหาย ให้หยุด write traffic ก่อน เลือก restore point ที่ยืนยัน
แล้ว และทำตาม incident runbook ของ Supabase การสลับไป project ใหม่ต้องอัปเดต
Edge/Vercel/Desktop configuration พร้อมกันและตรวจ Auth, API, Realtime และ
business smoke tests ก่อนเปิดขาย

ห้ามพิมพ์หรือบันทึก database URL, service role, access/refresh token หรือข้อมูล
ลูกค้าใน ticket, chat, screenshot และ log

## Desktop offline recovery

เมื่อเครื่องขายมีบิลรอซิงก์ โปรแกรมจะแจ้งเตือนก่อนปิด และอนุญาตให้ส่งออกไฟล์
`.posbackup` ที่เข้ารหัสด้วย Electron safeStorage/Windows account เดิม ไฟล์นี้มีไว้กู้คิว
บนเครื่องหรือ Windows profile เดิม ไม่ใช่ Database Backup และไม่ควรใช้แทนการซิงก์
หลังนำเข้า server ยังคงใช้ receipt number แบบ idempotent เพื่อป้องกันบิลซ้ำ
