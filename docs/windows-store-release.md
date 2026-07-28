# การเผยแพร่ผ่าน Microsoft Store

PumpPOS ใช้ช่องทาง AppX/MSIX ของ Microsoft Store เพื่อให้ Microsoft เป็นผู้เซ็น
แพ็กเกจสำหรับเผยแพร่ ดังนั้นช่องทางนี้ไม่จำเป็นต้องมีไฟล์ PFX แบบ public-trust,
รหัสผ่าน certificate หรือ hardware token อยู่ใน repository

## การตั้งค่า Partner Center ครั้งแรก

1. สร้างหรือตรวจสอบบัญชีนักพัฒนา Microsoft Partner Center
2. จองชื่อผลิตภัณฑ์ PumpPOS
3. เปิด **Product management > Product identity**
4. คัดลอกค่าต่อไปนี้จาก Partner Center มาใส่ใน PowerShell session ปัจจุบัน
   โดยต้องใช้ค่าตรงตามต้นฉบับทุกตัวอักษร:

```powershell
$env:PUMPPOS_STORE_IDENTITY_NAME = "<Package/Identity/Name>"
$env:PUMPPOS_STORE_PUBLISHER = "<Package/Identity/Publisher>"
$env:PUMPPOS_STORE_PUBLISHER_DISPLAY_NAME = "<Publisher display name>"
```

ห้ามเดาหรือปรับรูปแบบค่าเหล่านี้เอง เพราะ Partner Center จะปฏิเสธแพ็กเกจหาก
Identity หรือ Publisher ต่างจากข้อมูลที่กำหนดไว้แม้เพียงหนึ่งตัวอักษร
ค่า Identity เหล่านี้ไม่ใช่รหัสผ่าน แต่ห้ามนำข้อมูลเข้าสู่ระบบ รหัสกู้คืนบัญชี
หรือ secret อื่น ๆ ใส่ใน repository, log, ตัวแปร frontend หรือแชต

## การสร้างแพ็กเกจ

ก่อนมีผลิตภัณฑ์จริงใน Partner Center สามารถตรวจสอบ build pipeline ด้วยคำสั่ง:

```powershell
npm run dist:store:test
```

ไฟล์ทดสอบจะถูกสร้างไว้ใน `release/store-test/` และห้ามนำไปส่งให้ Partner Center

หลังจากตั้งค่า Product identity จริงครบแล้ว ให้สร้างแพ็กเกจสำหรับส่ง Store ด้วย:

```powershell
npm run dist:store
```

ไฟล์ `.appx` และไฟล์ `.appxupload` ที่แนะนำสำหรับส่ง Store จะถูกสร้างไว้ใน
`release/store/` ไฟล์เหล่านี้จะยังไม่มีลายเซ็นโดยตั้งใจ ให้อัปโหลดไฟล์
`.appxupload` ไปยัง Partner Center แล้ว Microsoft Store จะเซ็นแพ็กเกจให้หลัง
ผ่านการรับรอง ห้ามแจกไฟล์ที่ยังไม่ได้เซ็นให้ผู้ใช้โดยตรง และห้ามอัปโหลดไฟล์
Store ไปยัง bucket GCS ของระบบอัปเดต EXE เดิม

กระบวนการ build จะตรวจสอบ Manifest identity, Publisher, สถาปัตยกรรม x64,
Application ID, capability `runFullTrust` และตรวจว่าไม่มีลายเซ็น local
ติดเข้าไปโดยไม่ตั้งใจ

## การส่งและตรวจสอบแพ็กเกจ

1. อัปโหลดไฟล์ `.appxupload` จาก `release/store/` ไปยัง submission ใน
   Partner Center
2. กรอกหรือตรวจสอบ Properties, Age ratings, Privacy policy URL หรือข้อความ
   นโยบายความเป็นส่วนตัว, ภาพหน้าจอ, Pricing and availability และ Notes for
   certification หากมีช่องทางช่วยเหลือสาธารณะให้ใส่ข้อมูลติดต่อไว้ด้วย
3. สำหรับการเผยแพร่ครั้งแรกแบบควบคุม ให้เปิดการติดตั้งผ่านลิงก์ Store โดยตรง
   ก่อน หลังผ่าน certification ให้ติดตั้งจากลิงก์ดังกล่าวบนเครื่องสะอาดและ
   ทดสอบให้เรียบร้อยก่อนประชาสัมพันธ์ในวงกว้าง
4. ตรวจสอบการเข้าสู่ระบบ, การขายแบบออฟไลน์และการ sync outbox, การพิมพ์ใบเสร็จ,
   การเก็บข้อมูลในเครื่อง, การถอนติดตั้ง/ติดตั้งใหม่ และการอัปเดตผ่าน Store
5. ขยายการมองเห็นหรือการเผยแพร่บน Store หลัง production smoke test ผ่านแล้ว
   เท่านั้น

Store package จะไม่เริ่ม NSIS/GCS `electron-updater` เพราะ Microsoft Store
เป็นผู้จัดการการอัปเดตทั้งหมด การติดตั้ง NSIS รุ่น 2.1.3 เดิมต้องย้ายมาใช้รุ่น
Store ด้วยตนเองหนึ่งครั้ง ก่อนย้ายต้องสำรองหรือ sync รายการขายออฟไลน์ที่ยังค้าง
ให้หมด เนื่องจาก MSIX แยกพื้นที่ข้อมูลของแอป และการถอนติดตั้งอาจลบข้อมูลที่อยู่
ภายในพื้นที่เฉพาะของแพ็กเกจ

## ขั้นตอนอัปเดตเวอร์ชันบน Store

1. แก้ไขโค้ดและทดสอบระบบให้เรียบร้อย
2. เพิ่มหมายเลขเวอร์ชันให้สูงกว่าเวอร์ชันที่อยู่บน Store เช่น `2.1.6` เป็น
   `2.1.7`:

```powershell
npm version patch --no-git-tag-version
```

3. ตรวจสอบคุณภาพก่อน release:

```powershell
npm run check
npm run lint
npm test
npm audit --audit-level=high
```

4. หากมีการแก้ Backend หรือ Supabase ให้ deploy และทำ authenticated production
   smoke test ก่อนสร้าง Store package
5. ตั้งค่า Product identity เดิมใน PowerShell session แล้วรัน:

```powershell
npm run dist:store
```

6. เข้า Partner Center เลือก PumpPOS แล้วกด **Start update**
7. เปิด **Packages** และอัปโหลดไฟล์ `.appxupload` เวอร์ชันใหม่
8. ตรวจข้อมูลเดิมและปรับ **What's new in this version**, Notes for certification
   และบัญชีทดสอบตามความจำเป็น
9. ตรวจ Submission options แล้วกด **Submit for certification**
10. หลังผ่านการรับรอง ให้ตรวจว่า Current packages แสดงหมายเลขเวอร์ชันใหม่
    และทดสอบการอัปเดตผ่าน Microsoft Store บนเครื่องจริง

ข้อมูล Store listing เดิมจะถูกนำมาใช้เป็นจุดเริ่มต้นของ submission ใหม่
จึงไม่ต้องกรอกข้อมูลทั้งหมดใหม่ เว้นแต่มีการเปลี่ยนแปลงหรือ Partner Center
แจ้งให้ทบทวน

## เงื่อนไขก่อนเผยแพร่

- ห้ามสร้าง tag หรือประกาศเวอร์ชัน Store ก่อนผ่าน certification
- ห้ามอัปโหลด Store artifact ไปยัง GCS
- ห้ามส่ง artifact จาก `store-test` ให้ Partner Center
- ห้ามปิด Smart App Control บนเครื่องของลูกค้า
- Store package ทุกชุดต้องมีหมายเลขเวอร์ชันสูงกว่าชุดที่เผยแพร่แล้ว
- ให้เก็บ NSIS signing pipeline ไว้เป็นช่องทางสำรองสำหรับการแจก EXE โดยตรง
  ในอนาคต และต้องเซ็นด้วย public-trust certificate เท่านั้น
