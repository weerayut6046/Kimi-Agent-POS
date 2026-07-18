import { fmtMoney, fmtNum, fmtDateTimeTH, paymentLabel } from "@/lib/format";

type ReceiptSale = {
  receiptNo: string;
  createdAt: Date | string;
  subtotal: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentMethod: string;
  received: number;
  changeAmt: number;
  pointsEarned?: number;
  pointsRedeemed?: number;
  memberName?: string | null;
  customerName?: string | null;
};

type ReceiptItem = { name: string; qty: number; unit: string; unitPrice: number; amount: number };

type Props = {
  sale: ReceiptSale;
  items: ReceiptItem[];
  settingMap?: Record<string, string>;
  staffName?: string;
  logoUrl?: string | null;
};

function MoneyRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2${bold ? " font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ (แบบใบเสร็จม้วน) — ใช้ร่วมกันหน้า POS และหน้าประวัติการขาย */
export function ReceiptDoc({ sale, items, settingMap, staffName, logoUrl }: Props) {
  return (
    <div className="text-sm font-mono">
      {/* หัวใบเสร็จ — กึ่งกลางทั้งหมด */}
      <div className="text-center space-y-0.5">
        {logoUrl && <img src={logoUrl} alt="โลโก้ร้าน" className="h-12 w-auto object-contain mx-auto mb-1" />}
        <div className="font-bold text-base">
          {settingMap?.shop_name}
          {settingMap?.shop_branch ? ` สาขา ${settingMap.shop_branch}` : ""}
        </div>
        {settingMap?.shop_address && <div className="text-xs whitespace-pre-line">{settingMap.shop_address}</div>}
        <div className="text-xs">โทร. {settingMap?.shop_phone}</div>
        <div className="font-bold pt-1">ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ</div>
        <div className="text-xs">เลขประจำตัวผู้เสียภาษี {settingMap?.tax_id}</div>
      </div>

      {/* ข้อมูลบิล */}
      <div className="mt-2 text-xs space-y-0.5">
        <div>บิลเลขที่ : {sale.receiptNo}</div>
        <div>วันที่ : {fmtDateTimeTH(sale.createdAt)}</div>
        {staffName && <div>พนักงาน : {staffName}</div>}
        {sale.memberName && <div>สมาชิก : {sale.memberName}</div>}
        {sale.paymentMethod === "credit" && sale.customerName && <div>ลูกค้า : {sale.customerName}</div>}
      </div>

      {/* ตารางสินค้า */}
      <table className="w-full mt-2 border-collapse">
        <thead>
          <tr className="border-t border-b border-black">
            <th className="py-1 text-left font-bold">รายการสินค้า</th>
            <th className="py-1 w-20 text-center font-bold">จำนวน</th>
            <th className="py-1 w-24 text-right font-bold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="align-top">
              <td className="py-0.5 pr-2">
                {it.name}
                <span className="block text-xs">฿{fmtMoney(it.unitPrice)}/{it.unit}</span>
              </td>
              <td className="py-0.5 text-center whitespace-nowrap">{fmtNum(it.qty)}</td>
              <td className="py-0.5 text-right">{fmtMoney(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ยอดรวม */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <MoneyRow label="รวม" value={fmtMoney(sale.subtotal)} />
        {sale.discount > 0 && <MoneyRow label="ส่วนลด" value={fmtMoney(sale.discount)} bold />}
        <MoneyRow label="ยอดเงินสุทธิ" value={fmtMoney(sale.total)} bold />
        <MoneyRow label={`ภาษีมูลค่าเพิ่ม ${fmtNum(sale.vatRate)}% (รวมใน)`} value={fmtMoney(sale.vatAmount)} />
      </div>

      {/* การชำระเงิน */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5 text-xs">
        <MoneyRow label="ชำระโดย" value={paymentLabel[sale.paymentMethod] ?? sale.paymentMethod} />
        {sale.paymentMethod === "cash" && (
          <>
            <MoneyRow label="รับเงิน" value={fmtMoney(sale.received)} />
            <MoneyRow label="เงินทอน" value={fmtMoney(sale.changeAmt)} />
          </>
        )}
        {(sale.pointsEarned ?? 0) > 0 && <MoneyRow label="แต้มที่ได้รับ" value={`+${sale.pointsEarned}`} />}
        {(sale.pointsRedeemed ?? 0) > 0 && <MoneyRow label="แต้มที่ใช้" value={`-${sale.pointsRedeemed}`} />}
      </div>

      {/* หมายเหตุท้ายใบเสร็จ */}
      <div className="mt-2 text-xs space-y-0.5">
        <div>* ราคานี้รวมภาษีมูลค่าเพิ่มแล้ว</div>
        <div>** ต้องการใบกำกับภาษีเต็มรูป โปรดแจ้งเจ้าหน้าที่พร้อมใบเสร็จฉบับนี้</div>
      </div>
      <div className="text-center text-xs mt-2">ขอบคุณที่ใช้บริการ</div>
    </div>
  );
}
