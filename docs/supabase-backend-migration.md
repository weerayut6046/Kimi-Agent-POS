# Supabase backend and Auth cutover

PumpPOS production ย้าย backend cloud จาก Railway ไป Supabase Edge Functions
และใช้ Supabase Auth เป็นระบบ identity/session หลักแล้วเมื่อ 24 กรกฎาคม 2026

## สถานะ Production

- Frontend: `https://kimi-agent-pos.vercel.app`
- Backend: Supabase Edge Functions `pos-api` และ `pos-assistant`
- Auth: Supabase Auth email/password; หน้า Login ไม่มีโหมด PIN เดิม
- Database: Supabase PostgreSQL ใน private schema `pos`
- Railway: ไม่มี active deployment และ URL เดิมตอบ 404; service record กับ detached
  volume เก็บไว้ชั่วคราวสำหรับ rollback แบบควบคุม
- `pos-auth-bootstrap`: เปลี่ยนเป็น tombstone ที่ตอบ `410 MIGRATION_CLOSED`
  เท่านั้น ไม่โหลดฐานข้อมูลหรือ service role
- `pos-api-v2`: staging record ลบไม่ได้ด้วยสิทธิ์ deploy จึงถูกแทนด้วย tombstone
  ที่ต้องมี JWT และตอบ `410 STAGING_CLOSED`; ไม่มี business API หรือ DB access
- PIN เริ่มต้นเดิมของ manager/cashier ถูกยกเลิกทั้งหมด
- บัญชีที่เชื่อม Supabase Auth แล้ว 4 บัญชีล็อกอินสำเร็จครบทุกบทบาทที่มี
- พนักงานเดิมอีก 2 บัญชียังรอ admin กำหนดรหัสผ่านใหม่จากหน้า Workforce/Settings

## สถาปัตยกรรม

- Vercel ให้บริการ static frontend และ rewrite `/api/*` ไป Supabase
- `pos-api` ให้บริการ tRPC business API ทั้งหมดบน Supabase Edge Functions
- `pos-assistant` ส่งต่อภายในไป `pos-api` โดยไม่เรียก Railway
- Supabase Auth ออก access/refresh tokens; API ตรวจ JWT และโหลดพนักงานจาก
  `pos.staff_users` ทุก request
- API ตรวจ active staff, role, menu permission และ branch ฝั่ง server
- ตารางธุรกิจเปิด RLS แบบ deny-all ต่อ `anon`/`authenticated`; browser และ
  Desktop เข้าข้อมูลผ่าน Edge API เท่านั้น
- Realtime ใช้ private channel และส่งเฉพาะ opaque invalidation ไม่มี row payload
  หรือ PII

## Edge secrets

ตั้งค่าผ่าน Supabase secret manager เท่านั้น ห้าม commit หรือฝังใน frontend:

| Name | Purpose |
| --- | --- |
| `APP_ID` | application namespace |
| `APP_SECRET` | เข้ารหัส secret ของ AI settings; ใช้ random อย่างน้อย 32 bytes |
| `ALLOWED_ORIGINS` | รายการ origin ที่อนุญาตแบบ exact match |
| `SUPABASE_PROJECT_REF` | project ref สำหรับลิงก์และ metadata |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` และ
`SUPABASE_DB_URL` เป็น runtime secrets ที่ Supabase จัดให้ ห้ามคัดลอกไป
`VITE_*` ฝั่ง Vercel มีเฉพาะ URL และ publishable key ซึ่งออกแบบให้เปิดเผยต่อ
browser ได้

## Security gates

- ห้ามเปิด public signup; พนักงานต้องถูก provision/reset โดย admin เท่านั้น
- เปิด Leaked Password Protection ใน Supabase Auth
- กำหนดรหัสผ่านอย่างน้อย 10 ตัว มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข
- เปิด refresh-token rotation และกำหนด session timebox/inactivity timeout
- ห้ามใช้ `user_metadata` เป็นแหล่งตัดสินสิทธิ์
- ทุก business request ต้องตรวจ Supabase JWT, active staff, role, menu
  permission และ branch ฝั่ง server
- ห้าม log password, PIN, token, AI key, service role หรือ database URL
- ตรวจ Security/Performance Advisors และ dependency audit ก่อน deploy

ข้อมูล ณ วัน cutover ยังมีงานที่เจ้าของ Supabase project ต้องยืนยันใน Dashboard:

1. **Authentication > Sign In / Providers** — ปิดการสมัครผู้ใช้ใหม่จากสาธารณะ
2. **Authentication > Password Security** — เปิด Leaked Password Protection
3. ตั้ง password policy และ session policy ตามรายการ Security gates

แม้ public signup ยังเปิดอยู่ ผู้สมัครเองไม่สามารถอ่านตารางธุรกิจโดยตรงและ API
จะปฏิเสธบัญชีที่ไม่เชื่อมกับ active staff แต่ต้องปิดเพื่อกำจัดช่องทางสร้าง identity
ที่ไม่จำเป็น

## Deploy และตรวจรับรอบใหม่

1. รัน `npm run check`, `npm run lint`, `npm test`, `npm run build` และ
   `npm run build:edge`
2. Apply migration ด้วย `npx supabase db push`
3. Deploy `pos-api` และ `pos-assistant`; `pos-auth-bootstrap` ต้องคงเป็น tombstone
4. Deploy frontend ด้วย `npx vercel deploy --prod --yes`
5. Smoke test หน้าเว็บ, `/api/trpc/ping`, unauthorized request และยืนยันว่า
   `/api/auth/bootstrap` ตอบ 410
6. ทดสอบด้วยบัญชีแต่ละบทบาท: login, menu/branch permission, Realtime, เปิดกะ,
   ขาย, เปลี่ยนราคาในกะ, ปิดกะ, รายงาน และ logout
7. ตรวจ Edge/Auth/Postgres logs โดยไม่บันทึก credential หรือข้อมูลอ่อนไหว

## Rollback

เก็บ Vercel deployment ก่อนหน้าและ Railway detached volume ไว้ชั่วคราว หากต้อง
rollback ให้หยุด mutation ใหม่ก่อน ตรวจความสอดคล้องของฐานข้อมูล แล้วจึง promote
frontend เดิมและ redeploy Railway แบบควบคุม ห้ามเปิดระบบเดิมกับระบบใหม่ให้เขียน
รายการขายพร้อมกันเด็ดขาด
