# PumpPOS Flutter Mobile

แอปมือถืออยู่ในโฟลเดอร์ `mobile/` และใช้ Flutter codebase เดียวสำหรับ Android กับ iOS โดยเชื่อมกับ Supabase Auth และ Edge Function `pos-api` ชุดเดียวกับระบบเดิม

## สิ่งที่พร้อมใช้งาน

- เข้าสู่ระบบด้วยบัญชีพนักงานเดิมผ่าน Supabase Auth
- เก็บ session ใน Android Keystore และ iOS Keychain
- ตรวจสอบสิทธิ์เมนูและสาขาจาก `auth.currentStaff`
- Dashboard จริงจาก `pos.dashboard` พร้อม pull-to-refresh
- หน้าขายจริงจาก `catalog.listProducts` และ `pos.createSale`
- รองรับสินค้าเชื้อเพลิงแบบระบุยอดบาท/ลิตร สินค้าทั่วไป ตะกร้า และตรวจสต็อก
- คำนวณโปรโมชั่นต่อลิตรและโปรโมชั่นยอดเติมตามกติกาเดียวกับ backend
- ชำระด้วยเงินสด บัตร และ QR ของสาขาจาก `payments.promptpayQr`
- จัดการสมาชิก คะแนนสะสม ของรางวัล และสร้าง QR ให้ลูกค้าเปิดหน้าตรวจแต้มบนเว็บ
- เปิด–ปิดกะพร้อมบันทึกมิเตอร์ L/P เงินทอน เงินสด และยอดโอน
- แจ้งสถานะออฟไลน์จากการเชื่อมต่อของอุปกรณ์
- App Shell และรายการเมนูตามสิทธิ์สำหรับย้ายฟังก์ชัน POS ส่วนที่เหลือต่อ

การพิมพ์ใบเสร็จแบบเครื่องพิมพ์ความร้อนอัตโนมัติและ workflow เฉพาะอุปกรณ์บางส่วนยังต้องทดสอบบนเครื่องจริงก่อนนำ Mobile ไปแทนเครื่องขาย production

## ตั้งค่าสภาพแวดล้อม

ใช้เฉพาะ Supabase URL และ publishable key ที่อนุญาตให้เปิดเผยใน client เท่านั้น ห้ามใส่ `service_role`, secret key หรือ `DATABASE_URL` ในแอป

```powershell
cd mobile
flutter pub get
flutter run `
  --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co `
  --dart-define=SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY `
  --dart-define=SUPABASE_FUNCTION_REGION=ap-northeast-1 `
  --dart-define=PUBLIC_WEB_URL=https://YOUR_POS_WEB_DOMAIN
```

หากโปรเจกต์ยังใช้ legacy anon key ให้ส่งค่านั้นผ่าน `SUPABASE_PUBLISHABLE_KEY`; แอปใช้ค่าเป็น public `apikey` และยังบังคับ JWT ของพนักงานทุกคำขอ

## ตรวจและสร้างแอป

จากโฟลเดอร์รากของ repository:

```powershell
npm run mobile:check
npm run mobile:build:android
npm run mobile:build:ios
```

- Android ต้องติดตั้ง Android Studio/Android SDK และยอมรับ SDK licenses ก่อน
- iOS ต้องสร้างบน macOS ที่ติดตั้ง Xcode, CocoaPods และ signing profile
- Android application ID และ iOS bundle ID คือ `com.kimiagent.pos`
- เวอร์ชันอยู่ที่ `mobile/pubspec.yaml`; ค่า `2.1.11+2001011` หมายถึง version name `2.1.11` และ build number `2001011`
- ก่อนสร้าง Android release ให้คัดลอก `mobile/android/key.properties.example` เป็น `key.properties` แล้วใส่ upload keystore จริง ไฟล์ key และ `key.properties` ถูก ignore จาก Git

ตัวอย่างสร้าง release โดยส่ง configuration ตอน build:

```powershell
cd mobile
flutter build appbundle --release `
  --dart-define=SUPABASE_URL=https://YOUR_PROJECT.supabase.co `
  --dart-define=SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY `
  --dart-define=PUBLIC_WEB_URL=https://YOUR_POS_WEB_DOMAIN
```

บน macOS เปลี่ยนคำสั่งเป็น `flutter build ipa --release` สำหรับ iOS

## โครงสร้างสำคัญ

- `mobile/lib/core/` — configuration, theme, secure session storage และ tRPC client
- `mobile/lib/features/auth/` — login และ staff session
- `mobile/lib/features/dashboard/` — dashboard จาก backend จริง
- `mobile/lib/features/pos/` — สินค้า ตะกร้า โปรโมชั่น QR ชำระเงิน และบันทึกการขาย
- `mobile/lib/features/shifts/` — เปิด–ปิดกะและมิเตอร์หัวจ่าย
- `mobile/lib/features/shell/` — navigation ตามสิทธิ์
- `mobile/test/` — unit/widget tests ของ configuration, tRPC, auth, POS และกะงาน

Native project เดิมจาก Capacitor ถูกแทนด้วย `mobile/android` และ `mobile/ios` ของ Flutter แล้ว แอป Flutter เรียก Edge Function ผ่าน native HTTP โดยตรง จึงไม่ต้องเพิ่ม Capacitor origin ใน CORS
