# PumpPOS Mobile (Android และ iOS)

แอปมือถือใช้ Capacitor ครอบ React/Vite ชุดเดียวกับเว็บ จึงใช้หน้าจอ สิทธิ์ผู้ใช้ Supabase Auth และ tRPC API ชุดเดิม โดยมี native project แยกใน `android/` และ `ios/` สำหรับการเซ็นและเผยแพร่ขึ้นสโตร์

## สิ่งที่ต้องติดตั้ง

- Node.js 22.22 ขึ้นไปและ `npm install`
- Android: Android Studio รุ่นปัจจุบัน, Android SDK และ JDK ที่มากับ Android Studio
- iOS: macOS พร้อม Xcode รุ่นปัจจุบันและ Apple Developer account (ไม่สามารถคอมไพล์ iOS บน Windows)
- ตัวแปร build ฝั่ง client: `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`

ห้ามนำ `SUPABASE_SECRET_KEY`, `service_role`, `DATABASE_URL`, `APP_SECRET` หรือ secret ของระบบชำระเงินไปใส่ตัวแปร `VITE_*` เพราะค่ากลุ่มนี้ถูกฝังในแอปและผู้ใช้สามารถอ่านได้

## คำสั่งหลัก

```bash
npm run build:mobile          # build เว็บและ sync เข้า Android/iOS
npm run mobile:open:android   # เปิด native project ใน Android Studio
npm run mobile:open:ios       # เปิด native project ใน Xcode (macOS เท่านั้น)
```

รันบน emulator/device จาก command line:

```bash
npm run mobile:run:android
npm run mobile:run:ios        # macOS เท่านั้น
```

ทุกครั้งที่แก้ frontend, Capacitor config หรือเพิ่ม native plugin ให้รัน `npm run build:mobile` ก่อนเปิด build ใหม่

`build:mobile` จะซิงก์ `versionName`/`MARKETING_VERSION` จาก `package.json` และสร้าง build number จาก semver โดยอัตโนมัติ หาก CI ต้องการเลขที่สูงกว่าเดิมให้กำหนด `MOBILE_BUILD_NUMBER` เป็นจำนวนเต็มบวกที่ไม่ซ้ำ

## Backend และ CORS

แอป production เรียก Supabase Edge Function โดยตรงผ่าน HTTPS ไม่เรียก `/api/trpc` ที่เป็น relative URL ค่า origin ของ WebView ถูกตรึงไว้ดังนี้:

- Android: `https://localhost`
- iOS: `capacitor://localhost`

ทั้งสองค่าอยู่ใน exact allowlist ของ `supabase/functions/pos-api/cors.ts` ไม่มี wildcard origin และทุก request ธุรกิจยังต้องมี Supabase access token พร้อมตรวจสิทธิ์สาขา/เมนูที่ backend

ก่อนปล่อยรุ่นที่ใช้โค้ดนี้ ต้อง deploy Edge Function `pos-api` รุ่นล่าสุดด้วย `npm run build:edge` และ release workflow ของ Supabase ตามเอกสารโครงการ

## พฤติกรรม native ที่เตรียมไว้

- รองรับ safe area ของรอยบาก, Dynamic Island และ system navigation bar
- ตรวจ network ผ่าน native API และแจ้งเตือนทันทีเมื่อออฟไลน์
- Android back button ย้อนหน้าตาม history; เมื่ออยู่หน้ารากจะย่อแอป
- session ใช้ Supabase publishable key และ Bearer token; ไม่มี server secret ใน bundle
- เปิด URL ภายนอกใน browser ภายนอกตามค่าเริ่มต้นของ Capacitor

## ข้อจำกัดของรุ่นเริ่มต้น

Mobile ยังไม่มี durable offline sales outbox แบบ Desktop จึงต้องออนไลน์ก่อนบันทึกรายการขายหรือแก้ไขข้อมูล ระบบแสดงแถบเตือนชัดเจนเมื่อขาดการเชื่อมต่อ ห้ามโฆษณาว่า Mobile ขายออฟไลน์ได้จนกว่าจะย้ายและทดสอบ outbox/idempotency บน native storage แล้ว

## Checklist ก่อนส่ง Store

1. ตรวจ app icon และ splash ใน native projects เทียบกับไฟล์ต้นทาง `assets/logo.svg`; หากเปลี่ยนแบรนด์ต้องสร้าง native assets ทุกขนาดใหม่
2. ตั้ง Android signing keystore / iOS Team, provisioning และ bundle signing โดยไม่ commit private key
3. ทดสอบ login, เปลี่ยนสาขา, POS, QR, กล้อง/อัปโหลดรูป, export/print และ logout บนอุปกรณ์จริงทั้งสองระบบ
4. ทดสอบสลับ Wi-Fi/Cellular, background/foreground และ session refresh
5. รัน `npm run verify` และ `npm run build:mobile`
6. ตรวจ privacy disclosure, permission descriptions และข้อมูล Store listing ก่อนส่งตรวจ
