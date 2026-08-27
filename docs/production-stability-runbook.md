# Production stability runbook

เอกสารนี้เป็นเกณฑ์ตัดสินว่า PumpPOS รุ่นใดพร้อมใช้งานจริง และเป็นขั้นตอนรับมือเมื่อพบปัญหา

## 1. Automated gates

ทุก push และ pull request ต้องผ่าน workflow `Quality gates` ซึ่งรันคำสั่งต่อไปนี้:

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run build:edge
npm audit --audit-level=moderate
```

จากเครื่องนักพัฒนาใช้คำสั่งรวม `npm run verify` และก่อน release ใช้
`npm run verify:production`

ตั้งค่า branch protection ของ `main` ให้บังคับ status check ชื่อ
`Typecheck, lint, test, build, audit` และห้าม merge เมื่อ branch ยังไม่อัปเดตกับ `main`

## 2. Production smoke monitor

workflow `Production smoke` รันทุกชั่วโมงและสั่ง `npm run smoke:production` เพื่อตรวจ:

- หน้าเว็บและ SPA fallback
- JavaScript/CSS assets ของ deployment ปัจจุบัน
- CSP, HSTS และ security headers หลัก
- `pos-auth-bootstrap` ต้องปิดถาวรและตอบ `410 MIGRATION_CLOSED`
- request ที่ไม่มี API key ต้องถูกปฏิเสธ
- API ping ผ่าน Supabase gateway
- CORS allowlist ปฏิเสธ origin ภายนอก
- business procedures ปฏิเสธ request ที่ไม่มี user session
- method ที่ไม่รองรับและ unknown procedure ไม่เปิดเผย stack trace

สร้าง GitHub Actions repository variables:

- `SMOKE_BASE_URL` = `https://kimi-agent-pos.vercel.app`
- `SMOKE_SUPABASE_PUBLISHABLE_KEY` = publishable key ที่ยัง active

publishable key เป็น key สำหรับ public client แต่ต้องไม่ใช้ secret key หรือ
`service_role` ใน workflow นี้เด็ดขาด

รันจากเครื่องนักพัฒนาได้ด้วย:

```bash
npm run smoke:production
```

ค่าจาก `.env` และ `.env.local` จะถูกโหลดโดย Node เฉพาะ process นี้
และ smoke script จะไม่พิมพ์ key ออกทาง log

## 3. Supabase pre-release gate

ก่อน deploy migration หรือ Edge Function:

1. ตรวจ Security Advisor และ Performance Advisor
2. Security Advisor ต้องไม่มี `ERROR`; warning ต้องมีผู้รับผิดชอบและกำหนดวันแก้
3. เปิด **Auth > Password Security > Leaked Password Protection**
4. ยืนยันว่า public signup ปิด, refresh-token rotation เปิด, minimum password length อย่างน้อย 10 ตัว
5. ตรวจ Edge/Auth/Postgres/Realtime logs ย้อนหลัง 24 ชั่วโมง
6. apply migration ในช่วง traffic ต่ำ และรัน Advisors ซ้ำหลัง deploy
7. รัน `npx supabase migration list --linked`; local/remote history ต้องไม่มีรายการที่ไม่ทราบที่มา

ห้ามนำ `service_role`, database URL หรือ management access token ไปไว้ใน `VITE_*`,
GitHub variable หรือ browser bundle

## 4. Authenticated E2E checklist

ใช้ staging หรือสำเนาฐานข้อมูลที่ลบข้อมูลส่วนบุคคลแล้ว ห้ามทดสอบ restore บน production

- [ ] Login/logout, รหัสผ่านผิด และ session timeout
- [ ] สิทธิ์ Admin, Manager, Cashier และการแยกสาขา
- [ ] เปิดกะและบันทึกมิเตอร์เปิด
- [ ] ขายเงินสด, QR และเครดิต
- [ ] retry หลัง network หลุดและกดบันทึกซ้ำต้องไม่สร้างบิลซ้ำ
- [ ] โปรโมชั่น, สมาชิก, ส่วนลด, แต้ม และวันหมดอายุ
- [ ] เติมถัง, วัดถัง, เปลี่ยนราคา และนับสต๊อก
- [ ] ปิดกะและตรวจเงินสด/ยอดโอน/มิเตอร์
- [ ] รายงานยอดขาย สต๊อก และกำไรตรงกับรายการต้นทาง
- [ ] Realtime สองเครื่องเห็นการเปลี่ยนแปลงของสาขาที่มีสิทธิ์เท่านั้น
- [ ] ดาวน์โหลด `.posbackup` แล้ว restore ลงฐานทดสอบแบบ atomic
- [ ] จำนวนแถวและยอดรวมสำคัญก่อน/หลัง restore ตรงกัน

## 5. Pilot and acceptance criteria

เปิด pilot หนึ่งเครื่องหรือหนึ่งกะก่อนอย่างน้อย 48 ชั่วโมง และหยุดเพิ่มฟีเจอร์ระหว่างช่วงนี้

รุ่นถือว่าผ่านเมื่อ:

- automated gates และ production smoke ผ่านต่อเนื่อง
- E2E checklist ผ่านครบ
- ไม่มีบิลซ้ำ เลขเอกสารข้ามโดยผิดปกติ หรือยอดเงิน/สต๊อกคลาดเคลื่อน
- ไม่มี error ระดับรุนแรงซ้ำใน Edge/Auth/Postgres logs
- backup ล่าสุด restore ลงฐานทดสอบได้จริง

## 6. Rollback

เมื่อพบความผิดปกติที่กระทบยอดเงินหรือความถูกต้องของข้อมูล:

1. หยุดรับรายการใหม่และบันทึกเวลาที่เริ่มมีปัญหา
2. เก็บ Edge/Auth/Postgres logs และเลขบิลที่ได้รับผลกระทบ
3. promote Vercel deployment ก่อนหน้าและ deploy Edge Function รุ่นก่อน
4. ห้ามให้ระบบเก่าและใหม่เขียนฐานข้อมูลพร้อมกัน
5. migration ที่มีข้อมูลใหม่ให้ใช้ forward fix เป็นหลัก ห้าม rollback schema โดยไม่ตรวจ compatibility
6. restore ฐานข้อมูลเฉพาะเมื่อยืนยันขอบเขตข้อมูลเสียหายและมี snapshot ก่อนเหตุการณ์
7. ทำ reconciliation ยอดขาย เงินสด สต๊อก แต้ม และเลขเอกสารก่อนเปิดระบบอีกครั้ง
