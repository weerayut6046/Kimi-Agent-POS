import type { Sale, SaleItem, TaxInvoice } from "@db/schema";
import { fmtMoney, fmtNum, fmtDateTimeTH, paymentLabel } from "@/lib/format";
import { bahtText } from "@/lib/bahtText";

type Props = {
  sale: Sale;
  items: SaleItem[];
  invoice: TaxInvoice;
  settingMap?: Record<string, string>;
};

/** แถว "ป้ายกำกับ: ค่า" สำหรับก้อนข้อมูลลูกค้า */
function LabelRow({ label, value, pre }: { label: string; value: string; pre?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 shrink-0 font-semibold">{label}</span>
      <span className={pre ? "whitespace-pre-line" : ""}>{value}</span>
    </div>
  );
}

/** แถวเมตาดาต้าเอกสาร (ก้อนขวาบน) */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-36 shrink-0">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** เอกสารใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูป (A4 แนวตั้ง, แบบปั๊ม PTT) — ใช้ร่วมกันทั้ง preview และ print */
export function TaxInvoiceDoc({ sale, items, invoice, settingMap }: Props) {
  const preVat = Math.round((sale.total - sale.vatAmount) * 100) / 100;

  return (
    <div className="relative bg-white text-black text-[13px] leading-relaxed p-8 border shadow-sm w-[210mm] print:w-full mx-auto">
      {sale.status === "voided" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="border-4 border-red-500 text-red-500 text-5xl font-bold px-8 py-2 -rotate-12 opacity-60">
            ยกเลิก
          </span>
        </div>
      )}

      {/* ส่วนหัว: ข้อมูลร้านซ้าย / ชื่อเอกสารขวา */}
      <div className="flex justify-between gap-6">
        <div className="leading-snug">
          <div className="font-bold text-[15px]">{settingMap?.shop_name}</div>
          <div>เลขที่ประจำตัวผู้เสียภาษี {settingMap?.tax_id}</div>
          <div>สาขาที่ {settingMap?.shop_branch}</div>
          {settingMap?.shop_address && <div className="whitespace-pre-line">ที่อยู่ {settingMap.shop_address}</div>}
          <div>โทร. {settingMap?.shop_phone}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-bold text-[22px] leading-tight">ใบเสร็จรับเงิน/ใบกำกับภาษี</div>
          <div className="text-[15px] mt-0.5">RECEIPT/TAX INVOICE</div>
        </div>
      </div>

      {/* ข้อมูลลูกค้า (ซ้าย) / เลขที่-วันที่ (ขวา) */}
      <div className="flex justify-between gap-6 mt-8">
        <div className="space-y-1.5 min-w-0">
          <LabelRow label="ข้อมูลลูกค้า" value={invoice.customerName} />
          <LabelRow
            label="เลขประจำตัวผู้เสียภาษี"
            value={`${invoice.customerTaxId || "-"}${invoice.customerBranch ? ` ${invoice.customerBranch}` : ""}`}
          />
          {invoice.customerAddress && <LabelRow label="ที่อยู่" value={invoice.customerAddress} pre />}
          {invoice.customerPhone && <LabelRow label="โทรศัพท์" value={invoice.customerPhone} />}
          {invoice.vehiclePlate && <LabelRow label="ทะเบียนรถ" value={invoice.vehiclePlate} />}
        </div>
        <div className="shrink-0 space-y-1.5">
          <MetaRow label="เลขที่ใบกำกับภาษี" value={invoice.taxInvoiceNo} />
          <MetaRow label="เลขที่ใบเสร็จอย่างย่อ" value={sale.receiptNo} />
          <MetaRow label="วันที่ขาย" value={fmtDateTimeTH(sale.createdAt)} />
          <MetaRow label="วันที่พิมพ์" value={fmtDateTimeTH(new Date())} />
          <MetaRow label="พนักงาน" value={sale.staffName || invoice.issuedBy || "-"} />
        </div>
      </div>

      {/* ตารางสินค้า — เส้นบน/ล่างอย่างเดียว ไม่มีเส้นตั้ง */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr className="border-t-2 border-b-2 border-black">
            <th className="py-1.5 w-12 text-center font-semibold">ลำดับ</th>
            <th className="py-1.5 text-left font-semibold">รายการ</th>
            <th className="py-1.5 w-28 text-right font-semibold">ราคา/หน่วย</th>
            <th className="py-1.5 w-28 text-right font-semibold">ปริมาณ</th>
            <th className="py-1.5 w-32 text-right font-semibold">จำนวนเงิน(บาท)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id} className="align-top">
              <td className="py-1.5 text-center">{i + 1}</td>
              <td className="py-1.5 pr-2">{it.name}</td>
              <td className="py-1.5 text-right">{fmtMoney(it.unitPrice)}</td>
              <td className="py-1.5 text-right whitespace-nowrap">{fmtNum(it.qty)} {it.unit}</td>
              <td className="py-1.5 text-right">{fmtMoney(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ตัวอักษร/การชำระ (ซ้าย) + สรุปยอด (ขวา) */}
      <div className="flex justify-between gap-8 mt-3">
        <div className="space-y-1">
          <div>รวมเป็นเงินตัวอักษร ({bahtText(sale.total)})</div>
          <div>
            {paymentLabel[sale.paymentMethod]} : {fmtMoney(sale.total)}
            {sale.paymentMethod === "cash" && (
              <> (รับ {fmtMoney(sale.received)} ทอน {fmtMoney(sale.changeAmt)})</>
            )}
          </div>
        </div>
        <div className="w-80 shrink-0 space-y-1">
          {sale.discount > 0 && (
            <>
              <div className="flex justify-between"><span>รวม</span><span>{fmtMoney(sale.subtotal)}</span></div>
              <div className="flex justify-between"><span>ส่วนลด</span><span>-{fmtMoney(sale.discount)}</span></div>
            </>
          )}
          <div className="flex justify-between"><span>มูลค่าสินค้า</span><span>{fmtMoney(preVat)}</span></div>
          <div className="flex justify-between">
            <span>ภาษีมูลค่าเพิ่ม (Total VAT {fmtNum(sale.vatRate)}%)</span>
            <span>{fmtMoney(sale.vatAmount)}</span>
          </div>
          <div className="flex justify-between font-bold text-[15px] border-t border-black pt-1 mt-1">
            <span>รวมเป็นเงิน</span>
            <span>{fmtMoney(sale.total)}</span>
          </div>
        </div>
      </div>

      {/* ลายเซ็น */}
      <div className="mt-10 pt-3 border-t border-black">
        <div>ได้รับสินค้าตามรายการข้างบนนี้ไว้ถูกต้องและในสภาพเรียบร้อยทุกประการ</div>
        <div className="mt-4">ลงชื่อผู้รับเงิน : .......................................................................................</div>
        <div className="mt-1 ml-28">( {invoice.customerName} )</div>
      </div>
    </div>
  );
}
