# Database backup and restore runbook

Production ใช้ Supabase Managed Backups เป็นระบบสำรองข้อมูลหลัก หน้า Settings
แสดงสถานะและลิงก์ไป Supabase Dashboard แต่ไม่รับคำสั่งสร้าง ดาวน์โหลด ลบ หรือ
restore ฐานข้อมูลจาก application runtime

## Backup policy

- เปิด Scheduled Backups ตามแผน Supabase ของ project
- เปิด Point-in-Time Recovery เมื่อ RPO/RTO ของธุรกิจกำหนดให้ต้องใช้
- จำกัดสิทธิ์ Dashboard และ database credentials เฉพาะผู้ดูแลที่จำเป็น
- เปิด MFA ให้บัญชีผู้ดูแล Supabase ทุกบัญชี
- ตรวจ backup status อย่างน้อยทุกวัน และทำ restore drill ตามรอบที่กำหนด

## Restore drill

1. เลือก backup/restore point จาก Supabase Dashboard
2. Restore ไป project ทดสอบหรือ project ใหม่ ห้ามทับ production เพื่อการซ้อม
3. ใช้บัญชีทดสอบตรวจจำนวนตาราง ข้อมูลกะ ยอดขาย สต๊อก ลูกหนี้ เอกสารภาษี และ
   audit log
4. รัน smoke test แบบ read-only ก่อน แล้วจึงทดสอบ mutation กับสำเนา
5. บันทึกเวลา restore, RPO, RTO, ผู้ดำเนินการ และผลตรวจ
6. ลบ project ทดสอบตามนโยบาย retention เมื่อหลักฐานการซ้อมครบ

## Production recovery

เมื่อ production เสียหาย ให้หยุด write traffic ก่อน เลือก restore point ที่ยืนยัน
แล้ว และทำตาม incident runbook ของ Supabase การสลับไป project ใหม่ต้องอัปเดต
Edge/Vercel/Desktop configuration พร้อมกันและตรวจ Auth, API, Realtime และ
business smoke tests ก่อนเปิดขาย

ห้ามพิมพ์หรือบันทึก database URL, service role, access/refresh token หรือข้อมูล
ลูกค้าใน ticket, chat, screenshot และ log
