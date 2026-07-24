# Supabase mutation and authorization design

Business reads/writes ทำงานใน `pos-api` Supabase Edge Function ผ่าน tRPC และ
Drizzle/postgres.js โดยไม่เปิดตาราง `pos` ให้ browser เข้าถึงโดยตรง

## Request boundary

1. รับ Supabase access token จาก `Authorization: Bearer`
2. ตรวจ token กับ Supabase Auth
3. โหลด `pos.staff_users` ด้วย `supabase_auth_user_id`
4. ปฏิเสธบัญชี inactive และตรวจบทบาท/สิทธิ์รายเมนู
5. ตรวจ `x-branch-id` กับสาขาที่พนักงานได้รับอนุญาต
6. validate payload ด้วย Zod ก่อนเริ่ม transaction

ห้าม authorize จาก `user_metadata`, request body หรือค่า role ที่ client ส่งมา

## Write guarantees

- รายการขายใช้ idempotency key และ unique constraint ป้องกันการบันทึกซ้ำ
- การตัดสต๊อก การชำระเงิน แต้ม ลูกหนี้ และ audit log ที่สัมพันธ์กันต้องอยู่ใน
  transaction เดียว
- mutation สำคัญต้องเขียน audit log พร้อม actor/branch ที่ตรวจแล้ว
- ห้าม retry non-idempotent mutation โดยไม่มี idempotency key
- error response ต้องไม่เปิด SQL, secret, token หรือข้อมูลภายใน

## Realtime

หลัง commit สำเร็จ ระบบส่งเฉพาะ opaque invalidation ไป Supabase Realtime
private channel Client ใช้ event เพื่อ refetch ผ่าน API; event ไม่มี row payload,
PII หรือ credential

## Verification

- ทดสอบ no token, token เสีย/หมดอายุ, inactive staff และผิดสาขา
- ทดสอบ role/menu boundaries สำหรับ admin, manager และ cashier
- ทดสอบ duplicate/retry ของรายการขาย
- ทดสอบ rollback เมื่อขั้นตอนกลาง transaction ล้มเหลว
- ทดสอบว่า cashier ไม่ได้รับต้นทุนสินค้า
- ทดสอบ audit record ของ mutation สำคัญ
