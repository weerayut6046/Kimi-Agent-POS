import {
  ClipboardCheck,
  Contact,
  FileText,
  Landmark,
  ReceiptText,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Customer } from "@db/schema";
import {
  CheckLine,
  CreditFormFooter,
  CreditFormHeader,
  DateLine,
  FillLine,
  FORM_BLUE,
  ParenName,
  SectionBox,
  SectionPill,
  SignBox,
  SignLine,
  TaxIdBoxes,
  TermItem,
} from "@/components/creditFormParts";

type Props = {
  customer: Customer;
  /** ชื่อพนักงานที่พิมพ์ฟอร์ม — ใส่ในช่องผู้รับเรื่อง */
  staffName?: string;
  settingMap?: Record<string, string>;
  logoUrl?: string | null;
};

/** รายการเอกสารแนบในคอลัมน์ขวา */
function DocCheckItem({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-md border"
        style={{ borderColor: FORM_BLUE, color: FORM_BLUE }}
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-[2px] inline-block size-3 shrink-0 border border-slate-600" />
        <span className="min-w-0">{children}</span>
      </div>
    </div>
  );
}

/**
 * แบบฟอร์มการขอเปิดเครดิตเติมน้ำมัน (A4 แนวตั้ง 1 หน้า)
 * — ข้อมูลที่มีในระบบ (ชื่อ/เลขภาษี/ที่อยู่/โทรศัพท์) พิมพ์ให้แล้ว ช่องที่เหลือเขียนมือ
 */
export function CreditAccountRequestDoc({
  customer,
  staffName,
  settingMap,
  logoUrl,
}: Props) {
  const shopName = settingMap?.shop_name ?? "";

  return (
    <div
      id="credit-request-print"
      className="bg-white text-black text-[10.5px] leading-[1.3] p-[6mm] border shadow-sm w-[194mm] print:w-full mx-auto"
    >
      <CreditFormHeader
        title="แบบฟอร์มการขอเปิดเครดิต"
        subtitle="เติมน้ำมันสำหรับผู้รับเหมาถมดิน"
        settingMap={settingMap}
        logoUrl={logoUrl}
      />

      {/* คอลัมน์ซ้าย: ข้อ 1-4 / คอลัมน์ขวา: เอกสารแนบ */}
      <div className="flex gap-3 mt-2">
        <div className="flex-1 min-w-0 space-y-2">
          {/* 1. ข้อมูลสถานประกอบการ */}
          <section>
            <SectionPill no="1" title="ข้อมูลสถานประกอบการ (ผู้รับเหมา)" />
            <SectionBox className="space-y-1">
              <FillLine label="ชื่อกิจการ / บริษัท" value={customer.name} />
              <FillLine label="ชื่อผู้ประกอบการ / กรรมการผู้มีอำนาจลงนาม" />
              <FillLine label="ที่อยู่สำนักงาน" value={customer.address} />
              <div className="flex gap-3">
                <FillLine label="หมู่ที่" className="w-16" />
                <FillLine label="ตรอก/ซอย" className="flex-1" />
                <FillLine label="ถนน" className="flex-1" />
              </div>
              <div className="flex gap-3">
                <FillLine label="ตำบล/แขวง" className="flex-1" />
                <FillLine label="อำเภอ/เขต" className="flex-1" />
              </div>
              <div className="flex gap-3">
                <FillLine label="จังหวัด" className="flex-1" />
                <FillLine label="รหัสไปรษณีย์" className="w-32" />
              </div>
              <div className="flex gap-3">
                <FillLine label="โทรศัพท์สำนักงาน" className="flex-1" />
                <FillLine label="แฟกซ์" className="flex-1" />
              </div>
              <div className="flex gap-3">
                <FillLine
                  label="มือถือ"
                  value={customer.phone}
                  className="flex-1"
                />
                <FillLine label="E-mail" className="flex-1" />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
                <span>ประเภทธุรกิจ</span>
                <CheckLine label="รับเหมาถมดิน" />
                <CheckLine label="ขนดิน/ขนวัสดุก่อสร้าง" />
                <CheckLine label="อื่นๆ" />
                <FillLine className="w-24" />
              </div>
              <div className="flex items-center gap-2">
                <span className="shrink-0">เลขประจำตัวผู้เสียภาษี</span>
                <TaxIdBoxes taxId={customer.taxId} />
              </div>
            </SectionBox>
          </section>

          {/* 2. ข้อมูลผู้ติดต่อ */}
          <section>
            <SectionPill no="2" title="ข้อมูลผู้ติดต่อ / ผู้ดูแลบัญชี" />
            <SectionBox className="space-y-1">
              <div className="flex gap-3">
                <FillLine label="ชื่อ-สกุล" className="flex-1" />
                <FillLine label="ตำแหน่ง" className="flex-1" />
              </div>
              <div className="flex gap-3">
                <FillLine label="โทรศัพท์มือถือ" className="flex-1" />
                <FillLine label="E-mail" className="flex-1" />
              </div>
            </SectionBox>
          </section>

          {/* 3. เอกสารการจดทะเบียน */}
          <section>
            <SectionPill no="3" title="เอกสารการจดทะเบียน / ข้อมูลบริษัท" />
            <SectionBox className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <CheckLine label="บริษัทจำกัด" />
                <CheckLine label="ห้างหุ้นส่วนจำกัด" />
                <CheckLine label="ห้างหุ้นส่วนสามัญ" />
                <CheckLine label="บุคคลธรรมดา" />
              </div>
              <FillLine label="เลขที่ทะเบียนนิติบุคคล" />
              <div className="flex gap-3">
                <FillLine label="วันที่จดทะเบียน" className="flex-1" />
                <FillLine
                  label="ทุนจดทะเบียน"
                  suffix="บาท"
                  className="flex-1"
                />
              </div>
              <FillLine label="สำนักงานใหญ่ตั้งอยู่ที่" />
            </SectionBox>
          </section>

          {/* 4. ข้อมูลการดำเนินงาน */}
          <section>
            <SectionPill no="4" title="ข้อมูลการดำเนินงาน" />
            <SectionBox className="space-y-1">
              <FillLine label="ลักษณะงานที่รับเหมา" />
              <FillLine label="พื้นที่การดำเนินงานหลัก" />
              <FillLine label="มูลค่างานเฉลี่ยต่อโครงการ" suffix="บาท" />
              <FillLine
                label="จำนวนรถ/เครื่องจักรที่ใช้งาน ประมาณ"
                suffix="คัน"
              />
            </SectionBox>
          </section>
        </div>

        {/* เอกสารประกอบการขอเปิดเครดิต */}
        <aside className="w-[58mm] shrink-0">
          <div className="h-full rounded-xl border border-slate-400 p-2.5">
            <div className="text-center text-[12px] font-bold leading-snug">
              เอกสารประกอบการขอเปิดเครดิต
              <br />
              ที่แนบมาด้วย
            </div>
            <div className="mt-2 space-y-2 text-[10px]">
              <DocCheckItem icon={FileText}>
                1. หนังสือขอเปิดเครดิตกับทาง {shopName}
              </DocCheckItem>
              <DocCheckItem icon={Contact}>
                2. สำเนาบัตรประจำตัวประชาชนของผู้มีอำนาจลงนามในการสั่งซื้อ
              </DocCheckItem>
              <DocCheckItem icon={Users}>
                3. สำเนาหนังสือรับรองการจดทะเบียนนิติบุคคล อายุไม่เกิน 6 เดือน
              </DocCheckItem>
              <DocCheckItem icon={ReceiptText}>
                4. สำเนา ภ.พ.20 (ใบทะเบียนภาษีมูลค่าเพิ่ม)
                หรือสำเนาบัตรประจำตัวผู้เสียภาษีอากร
              </DocCheckItem>
              <DocCheckItem icon={Landmark}>
                5. สำเนาบัญชีธนาคาร ย้อนหลัง 6 เดือน (บัญชีชื่อบริษัท/กิจการ)
              </DocCheckItem>
              <DocCheckItem icon={Truck}>
                6. รายการรถบรรทุก / เครื่องจักรที่ใช้ในงาน (ระบุจำนวนและทะเบียน)
              </DocCheckItem>
              <DocCheckItem icon={ClipboardCheck}>
                7. ตัวอย่างใบสั่งซื้อของผู้ขอเปิดเครดิต หรือสัญญางาน/สัญญาจ้าง
              </DocCheckItem>
            </div>
            <div className="mt-2.5 text-[9px]">
              **หมายเหตุ : เอกสารทุกฉบับต้องเซ็นรับรองสำเนาถูกต้อง
              และประทับตราบริษัท (ถ้ามี)
            </div>
          </div>
        </aside>
      </div>

      {/* เงื่อนไขการชำระเงิน / การใช้งานบัตรเครดิต */}
      <div className="flex gap-3 mt-2">
        <section className="flex-1 min-w-0">
          <SectionPill title="เงื่อนไขการชำระเงิน" />
          <SectionBox>
            <ol className="space-y-1">
              <TermItem no="1">
                กำหนดชำระเงินภายใน 30 วัน นับจากวันที่ในใบแจ้งหนี้
                หากชำระล่าช้าบริษัทฯ จะคิดค่าใช้จ่าย 0.04% ต่อวัน
                จากยอดค้างชำระทั้งหมด
              </TermItem>
              <TermItem no="2">
                ซื้อสินค้าทุกวันที่ 1-15 ของเดือน วางบิลทุกวันที่ 16
                ชำระเงินภายในวันที่ 25 / ซื้อสินค้าทุกวันที่ 16-31 ของเดือน
                วางบิลทุกวันที่ 1 ชำระเงินภายในวันที่ 10 ของเดือนถัดไป
              </TermItem>
              <TermItem no="3">
                กรณีรับสินค้าเอง สินค้าประเภท &quot;ปูน&quot; ทางบริษัทฯ
                บวกเพิ่ม 1.5% จากราคาหน้าร้าน | สินค้าโครงสร้าง บวกเพิ่ม 1% |
                สินค้าอื่นๆ คิดราคาหน้าร้านปกติ ตามเงื่อนไขบริษัท
              </TermItem>
              <TermItem no="4">
                กรณีจัดส่งสินค้าทุกประเภท ทางบริษัทฯ บวกเพิ่ม 2.5%
                จากราคาหน้าร้าน ตามเงื่อนไขบริษัท
              </TermItem>
            </ol>
          </SectionBox>
        </section>
        <section className="flex-1 min-w-0">
          <SectionPill title="การใช้งานบัตรเครดิต" />
          <SectionBox>
            <ol className="space-y-1">
              <TermItem no="1">
                ใช้สิทธิ์เติมน้ำมันที่สถานีบริการ {shopName} เท่านั้น
                ไม่สามารถโอนสิทธิ์หรือเปลี่ยนแปลงผู้ใช้งานได้
              </TermItem>
              <TermItem no="2">
                บริษัทฯ ขอสงวนสิทธิ์ในการพิจารณาวงเงินเครดิต
                และอาจปรับวงเงินได้ตามความเหมาะสม
              </TermItem>
              <TermItem no="3">
                กรณีผิดนัดชำระ บริษัทฯ ขอสงวนสิทธิ์ระงับการให้เครดิต
                หรือหยุดให้บริการโดยไม่ต้องแจ้งให้ทราบล่วงหน้า
              </TermItem>
            </ol>
          </SectionBox>
        </section>
      </div>

      {/* ลายเซ็น */}
      <div className="flex gap-3 mt-2 break-inside-avoid">
        <SignBox
          className="flex-1"
          heading="ข้าพเจ้าขอรับรองว่าข้อมูลดังกล่าวข้างต้นเป็นความจริงทุกประการ"
        >
          <SignLine role="ผู้ยื่นคำขอ" center />
          <ParenName />
          <FillLine label="ตำแหน่ง" center />
          <DateLine />
        </SignBox>
        <SignBox className="flex-1" heading="สำหรับเจ้าหน้าที่บริษัท">
          <SignLine role="ผู้รับเรื่อง" name={staffName} center />
          <ParenName />
          <FillLine label="ตำแหน่ง" center />
          <DateLine />
        </SignBox>
      </div>

      <CreditFormFooter settingMap={settingMap} />
    </div>
  );
}
