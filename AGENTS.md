# Project instructions

## Permission registry is required

ทุกครั้งที่เพิ่ม แก้ไข หรือขยายฟังก์ชันที่ผู้ใช้เรียกใช้งาน ต้องตรวจระบบสิทธิ์ไปพร้อมกันเสมอ:

- ลงทะเบียนโมดูล/เมนูใหม่ใน `web/contracts/menuPermissions.ts` ซึ่งเป็นแหล่งข้อมูลกลางของหน้าตั้งค่าสิทธิ์ ค่าเริ่มต้นตามบทบาท และการตรวจ API
- ผูก route ฝั่งเว็บกับ `MenuRoute` และใช้ permission key จากทะเบียนกลาง ห้ามตรวจเฉพาะการซ่อนปุ่มหรือเมนู
- ผูก procedure ฝั่ง API กับ permission เดียวกัน การตรวจฝั่ง server เป็นข้อบังคับเสมอ
- หากเพิ่ม procedure ใต้ router ที่มี `apiPrefixes` ระบบต้องรับสิทธิ์ของโมดูลนั้นอัตโนมัติ หาก router ใช้ร่วมหลายโมดูล (`pos`, `catalog`, `payments`) ให้เพิ่มกติกาเฉพาะใน `getApiMenuPermissions`
- เพิ่มหรือปรับ automated tests เพื่อยืนยันค่าเริ่มต้นของบทบาท การ normalize ค่าจากฐานข้อมูล และ API permission mapping
- ผู้ดูแลระบบต้องคงสิทธิ์ทั้งหมดเพื่อป้องกันระบบไม่มีผู้ดูแล และห้ามลด role ceiling เดิมโดยไม่ได้รับคำสั่งชัดเจน

ฐานข้อมูลเก็บ permission keys ในคอลัมน์ JSONB จึงไม่ต้องสร้าง migration เมื่อเพิ่ม key ใหม่ แต่ถ้ามีการเปลี่ยน schema จริงให้สร้างและทดสอบ Supabase migration ตาม workflow ของโครงการ
