import { Info } from "lucide-react";
import type { Customer } from "@db/schema";
import { fmtDateTH } from "@/lib/format";
import {
  CreditFormFooter,
  CreditFormHeader,
  DateLine,
  FillLine,
  FORM_BLUE,
  ParenName,
  SignBox,
  SignLine,
  TaxIdBoxes,
} from "@/components/creditFormParts";

type Props = {
  customer: Customer;
  /** ชื่อพนักงานที่พิมพ์ฟอร์ม — ใส่ในช่องตรวจสอบโดย */
  staffName?: string;
  settingMap?: Record<string, string>;
  logoUrl?: string | null;
};

const ROW_COUNT = 15;

/**
 * แบบฟอร์มรายการรถบรรทุก/เครื่องจักรที่ใช้งาน สำหรับขอเปิดเครดิตเติมน้ำมัน (A4 แนวตั้ง 1 หน้า)
 * — ทะเบียนรถคันแรกดึงจากข้อมูลลูกค้าในระบบ ที่เหลือเขียนมือ
 */
export function VehicleFleetDoc({
  customer,
  staffName,
  settingMap,
  logoUrl,
}: Props) {
  return (
    <div
      id="vehicle-fleet-print"
      className="bg-white text-black text-[11px] leading-[1.35] p-[6mm] border shadow-sm w-[194mm] print:w-full mx-auto"
    >
      <CreditFormHeader
        title="แบบฟอร์มรายการรถบรรทุก/เครื่องจักรที่ใช้งาน"
        subtitle="สำหรับขอเปิดเครดิตเติมน้ำมัน"
        settingMap={settingMap}
        logoUrl={logoUrl}
      />

      {/* ข้อมูลกิจการ */}
      <div className="mt-2 space-y-1 rounded-xl border border-slate-400 p-2">
        <div className="flex gap-4">
          <FillLine
            label="ชื่อกิจการ / บริษัท"
            value={customer.name}
            className="flex-1"
          />
          <div className="shrink-0">
            วันที่ยื่นเอกสาร{" "}
            <span className="font-semibold">{fmtDateTH(new Date())}</span>
          </div>
        </div>
        <div className="flex gap-4">
          <FillLine
            label="ชื่อผู้ประกอบการ / กรรมการผู้มีอำนาจลงนาม"
            className="flex-1"
          />
          <FillLine
            label="เบอร์โทรศัพท์"
            value={customer.phone}
            className="w-[52mm] shrink-0"
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-1 items-center gap-2">
            <span className="shrink-0">เลขประจำตัวผู้เสียภาษี</span>
            <TaxIdBoxes taxId={customer.taxId} />
          </div>
          <FillLine
            label="สาขาที่ใช้บริการ"
            value={settingMap?.shop_branch}
            className="w-[52mm] shrink-0"
          />
        </div>
      </div>

      {/* คำชี้แจง */}
      <div className="mt-2 flex items-start gap-2">
        <span
          className="mt-[1px] grid size-5 shrink-0 place-items-center rounded-full text-white"
          style={{ backgroundColor: FORM_BLUE }}
        >
          <Info className="size-3" />
        </span>
        <div>
          <b>คำชี้แจง</b> กรุณากรอกรายการรถบรรทุก / เครื่องจักรที่ใช้งานในกิจการ
          เพื่อใช้ในการเติมน้ำมัน ภายใต้เงื่อนไขการให้เครดิตกับทาง{" "}
          {settingMap?.shop_name}
        </div>
      </div>

      {/* ตารางรายการรถ */}
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-500">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="text-white" style={{ backgroundColor: FORM_BLUE }}>
              <th
                rowSpan={2}
                className="w-10 border-r border-white/40 px-1 py-1 font-semibold"
              >
                ลำดับที่
              </th>
              <th
                rowSpan={2}
                className="border-r border-white/40 px-1 py-1 font-semibold"
              >
                ประเภทรถ/เครื่องจักร
                <br />
                (เช่น รถบรรทุก 10 ล้อ, รถแมคโคร)
              </th>
              <th
                rowSpan={2}
                className="w-24 border-r border-white/40 px-1 py-1 font-semibold"
              >
                ยี่ห้อ / รุ่น
              </th>
              <th
                rowSpan={2}
                className="w-28 border-r border-white/40 px-1 py-1 font-semibold"
              >
                เลขทะเบียนรถ/เลขตัวถัง
                <br />
                (ทะเบียนรถ/เลขเครื่องจักร)
              </th>
              <th
                rowSpan={2}
                className="w-16 border-r border-white/40 px-1 py-1 font-semibold"
              >
                จำนวน
                <br />
                (คัน/เครื่อง)
              </th>
              <th colSpan={2} className="px-1 py-1 font-semibold">
                ชื่อผู้ขับ/ผู้ควบคุม
              </th>
            </tr>
            <tr className="text-white" style={{ backgroundColor: FORM_BLUE }}>
              <th className="w-28 border-r border-t border-white/40 px-1 py-1 font-semibold">
                ชื่อ-สกุล
              </th>
              <th className="w-28 border-t border-white/40 px-1 py-1 font-semibold">
                เบอร์โทรศัพท์
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROW_COUNT }, (_, i) => (
              <tr
                key={i}
                className="h-[8mm] border-b border-dotted border-slate-400"
              >
                <td className="border-r border-slate-400 text-center">
                  {i + 1}
                </td>
                <td className="border-r border-slate-400" />
                <td className="border-r border-slate-400" />
                <td className="border-r border-slate-400 text-center font-semibold">
                  {i === 0 ? customer.vehiclePlate : ""}
                </td>
                <td className="border-r border-slate-400 text-center">
                  {i === 0 && customer.vehiclePlate ? "1" : ""}
                </td>
                <td className="border-r border-slate-400" />
                <td />
              </tr>
            ))}
            <tr>
              <td
                colSpan={4}
                className="border-r border-slate-400 py-1 text-center font-semibold"
              >
                รวมจำนวนทั้งสิ้น
              </td>
              <td className="border-r border-slate-400 text-center">
                {customer.vehiclePlate ? "1" : ""}
              </td>
              <td colSpan={2} className="text-center">
                คัน/เครื่อง
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-[9px]">
        หมายเหตุ : หากมีรายการมากกว่า {ROW_COUNT} รายการ กรุณาแนบเอกสารเพิ่มเติม
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
          <FillLine label="ตรวจสอบโดย" value={staffName} center />
          <FillLine label="ตำแหน่ง" center />
          <DateLine />
          <FillLine label="หมายเหตุ" center />
        </SignBox>
      </div>

      <CreditFormFooter settingMap={settingMap} />
    </div>
  );
}
