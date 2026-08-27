# QR ถุงเงิน (Krungthai Thungngern merchant)

โมดูลชำระเงินที่สร้าง QR **ล็อกยอดเงินของบิล** ให้ลูกค้าสแกนด้วยแอปธนาคารใดก็ได้
เงินเข้าบัญชีถุงเงิน (Thungngern) ของร้าน แล้วปิดบิลได้ 3 วิธี:

1. **webhook แจ้งเงินเข้าอัตโนมัติ** — แอปอ่าน notification บนมือถือของร้าน
   (เช่น ตังค์เข้า, PayNotify) ยิงยอดเงินเข้ามาที่ระบบ เห็น "เงินเข้าแล้ว" ทันที
2. **สแกนสลิป** — แคชเชียร์สแกน QR บนสลิปของลูกค้า ระบบตรวจสลิปกับ **Slip2Go** แล้วปิดบิล
3. **ยืนยันเอง** — ปุ่ม "ลูกค้าจ่ายแล้ว — ยืนยันเอง" (เหมือน QR เดิม)

ทุกวิธีปิดบิลแล้วพิมพ์ใบเสร็จให้ทันที และทุกวิธี idempotent (ปิดบิลได้ครั้งเดียว)

## QR ร้านค้าถุงเงิน vs พร้อมเพย์ส่วนตัว

ระบบรองรับ QR 2 โหมด (ตั้งค่าที่ ตั้งค่าระบบ > การชำระเงิน):

| โหมด | EMVCo tag | เงินเข้าบัญชี | เหมาะกับ |
| ---- | --------- | ------------- | -------- |
| **QR ร้านค้าถุงเงิน (merchant)** | tag 30, AID `A000000677010112` (bill payment) | บัญชีถุงเงินของร้านโดยตรง | ร้านที่ใช้ถุงเงินจริง (ค่าเริ่มต้นของสาขาหลัก) |
| **พร้อมเพย์ส่วนตัว (promptpay)** | tag 29, AID `A000000677010111` | บัญชีที่ผูกเบอร์/เลขบัตรนั้น — **ถ้าผูกกับบัญชีส่วนตัว เงินจะเข้าบัญชีส่วนตัว** | ทดสอบ หรือร้านที่ไม่มีถุงเงิน |

โหมด merchant ใช้ **static payload ต้นฉบับจากรูป QR ในแอปถุงเงิน** ของร้าน
หน้า Settings จะอ่าน QR จากรูป PNG/JPG/WebP ภายในเบราว์เซอร์ แล้วส่งเฉพาะ payload
ที่อ่านได้ไปตรวจสอบ รูปต้นฉบับไม่ถูกอัปโหลดหรือจัดเก็บบนเซิร์ฟเวอร์ จากนั้นระบบฉีดยอดเงิน
(tag 54) เข้าไปหลัง tag 53 แล้วคำนวณ CRC (tag 63)
ใหม่ทุกบิล โดยคง tag อื่นทั้งหมดตามต้นฉบับ: billerId (sub-tag 01),
ref1 = รหัสร้านค้า (sub-tag 02), ref2 = ชื่อบัญชี (sub-tag 03)

> ตัวอย่าง payload ของสาขาหลัก: billerId `010753700088205`,
> รหัสร้านค้า `2214117056022000909`, ชื่อบัญชี `WEERAYUTNAMWONGSA`

## การทำงานโดยย่อ

1. แคชเชียร์เลือกช่องทาง **QR ถุงเงิน** ในหน้าขาย แล้วกดยืนยันการชำระเงิน
2. เซิร์ฟเวอร์สร้าง payment session (ล็อกยอด + snapshot บิล, อายุ 5 นาที)
   แล้วสร้าง QR payload ตามโหมด:
   - merchant: ฉีดยอดเข้า static payload ของร้าน + CRC ใหม่
   - promptpay: สร้าง PromptPay payload (EMVCo Thai QR) จาก PromptPay ID
3. ลูกค้าสแกน QR จ่ายเงินจากแอปธนาคารของตัวเอง แล้วยื่นสลิปให้แคชเชียร์
4. แคชเชียร์ **สแกน QR บนสลิป** (เครื่องอ่านบาร์โค้ด/กล้อง/วางข้อความ) ลงช่องใน dialog
   → เซิร์ฟเวอร์เรียก Slip2Go `POST /api/verify-slip/qr-code/info` พร้อม
   `checkDuplicate: true` — สลิปที่เคยตรวจแล้วจะถูกปฏิเสธ
5. ตรวจบัญชีปลายทางแยกตามโหมด:
   - **promptpay**: ส่ง `checkReceiver` ให้ Slip2Go ตรวจ (10 หลัก → `02001`, 13 หลัก → `02003`)
   - **merchant**: Slip2Go ไม่มี accountType สำหรับ biller QR ถุงเงิน จึง **ไม่ส่ง checkReceiver**
     แต่ตรวจเองจากผลสลิป — ผู้รับ (`receiver.account.proxy.account` หรือ
     `receiver.account.bank.account`) ต้องตรง **ref1 หรือ billerId** ของร้าน
     (เซิร์ฟเวอร์ log receiver ของสลิปไว้ทุกครั้งจนกว่าจะยืนยันรูปร่างกับสลิปจริง)
6. เซิร์ฟเวอร์ตรวจเพิ่มเองอีกชั้น (ไม่ส่ง checkAmount/checkDate ให้ provider):
   - **ยอดเงิน** ตรงกับยอดบิลแบบแม่นยำระดับสตางค์
   - **เวลารายการ** อยู่ในช่วง [สร้าง session − 5 นาที, ตอนนี้]
   - **transRef** ยังไม่เคยใช้ปิดบิลอื่นของสาขานี้ (สลิป 1 ใบใช้ได้ 1 บิล)
7. ผ่านทุกเงื่อนไข → สร้างบิล (วิธีชำระ `thungngern`) + หักสต๊อก + แต้มสมาชิก ใน transaction เดียว
   (idempotent — สแกนซ้ำ/กดยืนยันเองพร้อมกันปิดบิลได้ครั้งเดียว)
8. ทางเลือกของแคชเชียร์: ปุ่ม **"ลูกค้าจ่ายแล้ว — ยืนยันเอง"** (เหมือน QR เดิม) หรือ **ยกเลิก**
9. **ออฟไลน์ (Desktop)** — บันทึกเป็นบิล `thungngern` รอยืนยันในเครื่องผ่าน outbox เดิม
   และซิงก์ขึ้นคลาวด์อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา

> ไม่มี polling ไปหาธนาคาร/provider ฝั่งเซิร์ฟเวอร์ — การปิดบิลอัตโนมัติเกิดจาก
> (ก) webhook แจ้งเงินเข้าจากแอปบนมือถือของร้าน (ข) การสแกนสลิปของแคชเชียร์
> (ค) ปุ่มยืนยันเอง เท่านั้น (`payments.sessionStatus` อ่านสถานะอย่างเดียว)

## แจ้งเงินเข้าอัตโนมัติ (Webhook)

Slip2Go ตรวจได้เฉพาะ "สลิป" — ไม่มีทางรู้เองว่าเงินเข้าบัญชีแล้ว
ระบบจึงรับแจ้งจาก **แอปอ่าน notification บนมือถือเครื่องที่ล็อกอินแอปถุงเงิน/ธนาคารของร้าน**
(เช่น ตังค์เข้า, PayNotify, MacroDroid) — เมื่อธนาคารเด้งแจ้ง "เงินเข้า"
แอปจะยิงยอดเงินมาที่ endpoint ของเรา:

```
POST {webhook URL จาก ตั้งค่าระบบ > การชำระเงิน}?branch=<เลขสาขา>
Authorization: Bearer <webhook token>
Content-Type: application/json

{"amount": 100.00, "text": "เงินเข้า 100.00 บาท", "ref": "รหัสแจ้งเตือนจากแอป (ถ้ามี)"}
```

- **URL**: Supabase Edge `…/functions/v1/pos-api/payments/incoming` หรือ
  เซิร์ฟเวอร์ Node ตัวเอง `/api/payments/incoming` — คัดลอกจากหน้าตั้งค่า
  (มือถือต้องเข้าถึง URL นี้ผ่านอินเทอร์เน็ตได้)
- **token**: สร้าง/เปลี่ยนได้ที่ ตั้งค่าระบบ > การชำระเงิน (admin) — เข้ารหัส
  AES-256-GCM ก่อนลงฐานข้อมูล เห็นค่าจริงได้เฉพาะ admin; รับได้ทั้ง
  header `Authorization: Bearer`, header `x-webhook-token` หรือ field `token` ใน body
- **ยอดเงิน**: ส่ง `amount` (ตัวเลขบาท) ชัดเจนที่สุด — ถ้าไม่ส่ง ระบบจะ parse จาก
  `text`/`message`/`body` (ตัวเลขที่ตามด้วย "บาท"/"THB" หรือหลังคำว่า เงินเข้า/รับโอน)

### กติกาการจับคู่บิล (ตั้งใจให้ปลอดภัยกว่าให้บริการ)

1. ยอดต้องตรงเป๊ะระดับสตางค์กับ payment session ที่ **pending และยังไม่หมดเวลา**
2. ต้องเหลือบิลที่ยอดตรง **พอดี 1 บิล** — ถ้ายอดเดียวกันค้าง 2 บิลขึ้นไป ระบบ
   **ไม่เดา** (ตอบ `ambiguous_amount`) แคชเชียร์สแกนสลิปยืนยันตามเดิม
3. ไม่มีบิลรอยอดนั้น → ตอบ `no_pending_bill` (HTTP 200) ไม่สร้างบิล —
   เงินอาจเป็นรายการอื่นของร้าน ไม่ใช่ของบิล QR
4. แจ้งซ้ำด้วย `ref` เดิม (หรือ hash ของ amount+เวลา+ข้อความชุดเดิม) →
   คืนบิลเดิม `duplicate: true` ไม่สร้างบิลซ้ำ — transRef ของ session
   ถูกบังคับ unique เหมือนสลิป
5. ปิดบิลแล้วหน้าจอ POS (poll ทุก 3 วินาที) แจ้ง **"เงินเข้าแล้ว"** พร้อมเสียงสั้น
   และพิมพ์ใบเสร็จต่ออัตโนมัติ — ทุกการปิดผ่าน webhook บันทึก audit
   (`thungngern_webhook_confirm`, confirmedBy = `webhook`)

> ข้อควรรู้: ช่องทางนี้ **ไม่ได้ยืนยันกับธนาคาร** — ความถูกต้องขึ้นกับแอปแจ้งเตือน
> และความลับของ token ถ้าต้องการหลักฐานระดับสลิป ให้ใช้การสแกนสลิป Slip2Go เหมือนเดิม

## ตั้งค่าครั้งแรก

1. สมัคร/เข้าสู่ระบบที่ [Slip2Go](https://slip2go.com) แล้วเปิด **Dashboard > API Connect**
   เพื่อสร้างและคัดลอก **API Secret**
2. ใน POS: admin เปิด **ตั้งค่าระบบ > การชำระเงิน** แล้ว
   - เปิดใช้งาน QR ถุงเงิน
   - เลือกโหมด **QR ร้านค้าถุงเงิน** — การ์ดจะแสดงรหัสร้านค้า/ชื่อบัญชี/Biller ID ที่บันทึกไว้
   - อัปโหลดรูป QR ร้านค้าจากแอปถุงเงิน ระบบอ่าน QR ในเครื่องและแสดง Biller ID/Ref
     ให้ตรวจสอบก่อนบันทึก (เซิร์ฟเวอร์ตรวจโครงสร้าง EMVCo + AID ซ้ำอีกครั้ง)
   - วาง **Slip2Go API Secret** (ช่องเขียนอย่างเดียว — เข้ารหัส AES-256-GCM ก่อนลงฐานข้อมูล,
     client ไม่เคยเห็น secret จริง)
   - กด **ทดสอบการเชื่อมต่อ** — ระบบเรียก `GET /api/account/info` และแสดงชื่อร้าน
     แพ็กเกจ วันหมดอายุ Token คงเหลือ และจำนวนครั้งที่เช็กสลิปได้โดยประมาณ
3. (แนะนำ) ตั้ง IP whitelist ใน Slip2Go Dashboard ให้ตรงกับ IP ขาออกของเซิร์ฟเวอร์
   (Supabase Edge egress) ถ้าแพ็กเกจรองรับ

## โควตา Slip2Go

- การตรวจสลิป 1 ครั้งใช้ **0.5 Token** (ดู `tokenPerSlip` จาก `/api/account/info`)
- เซิร์ฟเวอร์เรียก provider เฉพาะตอนแคชเชียร์กดตรวจสลิปเท่านั้น — session ที่ปิดแล้ว
  จะไม่เรียกซ้ำ (คืนบิลเดิมทันที) จึงไม่เสียโควตาเปล่า

## Environment variables (ฝั่งเซิร์ฟเวอร์เท่านั้น — ห้ามใส่ใน `VITE_*`)

| ตัวแปร | ค่าเริ่มต้น | ใช้สำหรับ |
| ------ | ----------- | --------- |
| `SLIP2GO_BASE_URL` | `https://connect.slip2go.com` | base URL ของ Slip2Go API |
| `SLIP2GO_API_SECRET` | (ว่าง) | secret สำรองระดับเซิร์ฟเวอร์ — ใช้เมื่อสาขายังไม่ได้บันทึก secret ไว้ในตาราง |
| `SLIP2GO_TIMEOUT_MS` | `8000` | timeout ต่อครั้ง (1,000–30,000) |
| `SLIP2GO_MOCK` | (ว่าง) | `1` = client จำลอง ไม่เรียก network (dev/test) |

## ไฟล์ที่เกี่ยวข้อง

| ตำแหน่ง | หน้าที่ |
| ------- | ------- |
| `web/api/lib/promptpay.ts` | EMVCo TLV parser/builder + CRC16-CCITT, PromptPay payload, ฉีดยอดเข้า merchant QR (`injectAmountIntoMerchantQr`) |
| `web/api/payments/slip2go-client.ts` | Slip2Go client — endpoint/contract ภายนอกทั้งหมดอยู่ไฟล์นี้ไฟล์เดียว |
| `web/api/payments/paymentConfig.ts` | ตั้งค่าระดับสาขา + เข้ารหัส/ถอดรหัส Slip2Go secret |
| `web/api/payments/sessionService.ts` | session รอชำระ, finalize แบบ idempotent, ตรวจสลิป (`verifySlipWithClient`) |
| `web/api/payments/incomingPayment.ts` | รับแจ้งเงินเข้า: ตรวจ token, ดึงยอด, จับคู่ session, ปิดบิล (`processIncomingPayment`) |
| `web/api/payments/incomingPaymentHttp.ts` | HTTP shim ของ webhook — ใช้ร่วมกันทั้ง Node (`boot.ts`) และ Supabase Edge (`functions/pos-api/index.ts`) |
| `web/api/routers/payments.ts` | tRPC router `payments.*` |
| `web/src/components/ThungngernQrDialog.tsx` | dialog QR + ช่องสแกนสลิป + นับถอยหลัง ในหน้าขาย |
| `web/db/migrations-postgres/0011_dusty_paladin.sql` | ตาราง `pos.payment_settings`, `pos.payment_sessions` |
| `web/db/migrations-postgres/0012_noisy_dragon_man.sql` | เพิ่ม `provider` และ `trans_ref` (unique เฉพาะที่มีค่า — กันสลิปซ้ำข้ามบิล) |
| `web/db/migrations-postgres/0013_vengeful_tenebrous.sql` | เพิ่ม `qr_mode` และ `merchant_payload` (โหมด QR ร้านค้าถุงเงิน) |
| `web/db/migrations-postgres/0014_perpetual_selene.sql` | เพิ่ม `webhook_token_encrypted` (token รับแจ้งเงินเข้าอัตโนมัติ) |

## ความปลอดภัย

- secret ถูกเข้ารหัส AES-256-GCM ด้วยกุญแจที่ derive จาก `APP_SECRET`
  (scope `pump-pos:payments-secret:v1`) ก่อนลงตาราง `pos.payment_settings`
  — webhook token ใช้กลไกเดียวกัน (context แยก `…:webhook-token:v1`)
  และเปรียบเทียบแบบ constant-time ตอนรับแจ้ง
- หน้าเว็บเห็นเพียงสถานะ "ตั้งค่าแล้ว/ยังไม่ได้ตั้งค่า" — secret ไม่เคยออกนอกเซิร์ฟเวอร์
  (webhook token แสดงเฉพาะหน้าตั้งค่าของ admin เพื่อคัดลอกไปตั้งแอป)
- ทุกการยืนยันผ่านสลิปถูกบันทึก audit (`thungngern_slip_verify`) พร้อมเลขบิลและ transRef
- สลิปปลอม/สลิปซ้ำ/สลิปคนละบัญชี/ยอดไม่ตรง/นอกช่วงเวลา ถูกปฏิเสธพร้อมข้อความไทยที่หน้าจอ
  และ session ยังคง pending ให้ลองใหม่ได้จนกว่าจะหมดเวลา

## สิ่งที่ยังไม่ได้ยืนยันกับของจริง (รอทดสอบโอน 1 บาท)

- รูปร่าง `receiver` ในผลสลิปของรายการที่จ่ายเข้า **biller QR ถุงเงิน** (tag 30) —
  โค้ดรองรับทั้ง `proxy.account` และ `bank.account` เทียบกับ ref1/billerId
  และ log receiver ไว้ที่เซิร์ฟเวอร์ทุกครั้ง ถ้าสลิปจริงไม่ตรงทั้งสองช่อง
  ให้ดู log แล้วปรับ `acceptedAccounts`/การ parse ใน `slip2go-client.ts`
- ข้อความ error ของ Slip2Go สำหรับสลิปซ้ำ — ตอนนี้จับจากคำว่า "duplicat"
  ใน code/message; ถ้าของจริงใช้ข้อความอื่นจะไปอยู่ในสาขา "สลิปไม่ถูกต้อง" แทน
