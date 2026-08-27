import { fmtMoney, fmtNum, fmtDateTimeTH, paymentLabel } from "@/lib/format";
import {
  DEFAULT_POINT_REDEEM_VALUE,
  positiveSettingNumber,
} from "@contracts/settings";
import type {
  AppliedBillThresholdPromotion,
  AppliedReceiptPromotion,
} from "@contracts/promotion";

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
  transactionType?: "sale" | "return";
  originalReceiptNo?: string | null;
  returnReason?: string | null;
};

type ReceiptItem = {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
};

type Props = {
  sale: ReceiptSale;
  items: ReceiptItem[];
  settingMap?: Record<string, string>;
  staffName?: string;
  logoUrl?: string | null;
  promotion?: AppliedReceiptPromotion;
  billPromotion?: AppliedBillThresholdPromotion;
};

function MoneyRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-2${bold ? " font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ (แบบใบเสร็จม้วน) — ใช้ร่วมกันหน้า POS และหน้าประวัติการขาย */
export function ReceiptDoc({
  sale,
  items,
  settingMap,
  staffName,
  logoUrl,
  promotion,
  billPromotion,
}: Props) {
  const isReturn = sale.transactionType === "return";
  const pointValue = positiveSettingNumber(
    settingMap?.point_redeem_value,
    DEFAULT_POINT_REDEEM_VALUE
  );
  const pointDiscount = isReturn
    ? 0
    : Math.min(
        sale.discount,
        Math.max(0, sale.pointsRedeemed ?? 0) * pointValue
      );
  const promotionDiscount = isReturn
    ? 0
    : Math.min(
        Math.max(0, sale.discount - pointDiscount),
        Math.max(0, promotion?.discount ?? 0)
      );
  const billPromotionDiscount = isReturn
    ? 0
    : Math.min(
        Math.max(0, sale.discount - pointDiscount - promotionDiscount),
        Math.max(0, billPromotion?.appliedDiscount ?? 0)
      );
  const cashDiscount = Math.max(
    0,
    sale.discount - pointDiscount - promotionDiscount - billPromotionDiscount
  );
  return (
    <div className="text-sm font-mono">
      {/* หัวใบเสร็จ — กึ่งกลางทั้งหมด */}
      <div className="text-center space-y-0.5">
        {logoUrl && (
          <img
            src={logoUrl}
            alt="โลโก้ร้าน"
            className="h-12 w-auto object-contain mx-auto mb-1"
          />
        )}
        <div className="font-bold text-base">
          {settingMap?.shop_name}
          {settingMap?.shop_branch ? ` สาขา ${settingMap.shop_branch}` : ""}
        </div>
        {settingMap?.shop_address && (
          <div className="text-xs whitespace-pre-line">
            {settingMap.shop_address}
          </div>
        )}
        <div className="text-xs">โทร. {settingMap?.shop_phone}</div>
        <div className="font-bold pt-1">
          {isReturn
            ? "ใบรับคืนสินค้า/ใบคืนเงิน"
            : "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ"}
        </div>
        <div className="text-xs">
          เลขประจำตัวผู้เสียภาษี {settingMap?.tax_id}
        </div>
      </div>

      {/* ข้อมูลบิล */}
      <div className="mt-2 text-xs space-y-0.5">
        <div>บิลเลขที่ : {sale.receiptNo}</div>
        {isReturn && sale.originalReceiptNo && (
          <div>อ้างอิงบิล : {sale.originalReceiptNo}</div>
        )}
        <div>วันที่ : {fmtDateTimeTH(sale.createdAt)}</div>
        {staffName && <div>พนักงาน : {staffName}</div>}
        {sale.memberName && <div>สมาชิก : {sale.memberName}</div>}
        {sale.paymentMethod === "credit" && sale.customerName && (
          <div>ลูกค้า : {sale.customerName}</div>
        )}
      </div>

      {/* ตารางสินค้า — table-fixed กันคอลัมน์ดันกว้างเกินกรอบ/แคบเกิน (เคยล้นขอบ dialog ในบางเบราว์เซอร์) */}
      <table className="w-full table-fixed mt-2 border-collapse">
        <thead>
          <tr className="border-t border-b border-black">
            <th className="py-1 text-left font-bold">รายการสินค้า</th>
            <th className="py-1 w-14 text-center font-bold">จำนวน</th>
            <th className="py-1 w-28 text-right font-bold">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="align-top">
              <td className="py-0.5 pr-2 break-words">
                {it.name}
                <span className="block text-xs">
                  ฿{fmtMoney(it.unitPrice)}/{it.unit}
                </span>
              </td>
              <td className="py-0.5 text-center whitespace-nowrap">
                {fmtNum(isReturn ? Math.abs(it.qty) : it.qty)}
              </td>
              <td className="py-0.5 text-right whitespace-nowrap">
                {fmtMoney(isReturn ? Math.abs(it.amount) : it.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ยอดรวม */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <MoneyRow
          label={isReturn ? "มูลค่าสินค้าคืน" : "รวม"}
          value={fmtMoney(isReturn ? Math.abs(sale.subtotal) : sale.subtotal)}
        />
        {isReturn && sale.discount < 0 && (
          <MoneyRow
            label="หักส่วนลดตามบิลเดิม"
            value={fmtMoney(Math.abs(sale.discount))}
            bold
          />
        )}
        {!isReturn && cashDiscount > 0 && (
          <MoneyRow label="ส่วนลดท้ายบิล" value={fmtMoney(cashDiscount)} bold />
        )}
        {!isReturn && promotion && promotionDiscount > 0 && (
          <>
            <MoneyRow
              label={promotion.name}
              value={fmtMoney(promotionDiscount)}
              bold
            />
            <div className="text-xs">
              ลด {fmtMoney(promotion.discountPerLiter)} บาท/ลิตร ×{" "}
              {fmtNum(promotion.liters)} ลิตร
            </div>
          </>
        )}
        {!isReturn && billPromotion && billPromotionDiscount > 0 && (
          <>
            <MoneyRow
              label={billPromotion.name}
              value={fmtMoney(billPromotionDiscount)}
              bold
            />
            <div className="text-xs">
              ยอดเติมน้ำมัน {fmtMoney(billPromotion.fuelSpend)} บาท (เกณฑ์{" "}
              {fmtMoney(billPromotion.minimumFuelSpend)} บาท)
            </div>
          </>
        )}
        {!isReturn && pointDiscount > 0 && (
          <MoneyRow
            label={`ส่วนลดจากแต้ม (${sale.pointsRedeemed} แต้ม)`}
            value={fmtMoney(pointDiscount)}
            bold
          />
        )}
        <MoneyRow
          label={isReturn ? "ยอดคืนเงิน" : "ยอดเงินสุทธิ"}
          value={fmtMoney(isReturn ? Math.abs(sale.total) : sale.total)}
          bold
        />
        <MoneyRow
          label={`ภาษีมูลค่าเพิ่ม ${fmtNum(sale.vatRate)}% (รวมใน)`}
          value={fmtMoney(isReturn ? Math.abs(sale.vatAmount) : sale.vatAmount)}
        />
      </div>

      {/* การชำระเงิน */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5 text-xs">
        <MoneyRow
          label={isReturn ? "คืนเงินโดย" : "ชำระโดย"}
          value={paymentLabel[sale.paymentMethod] ?? sale.paymentMethod}
        />
        {sale.paymentMethod === "cash" && !isReturn && (
          <>
            <MoneyRow label="รับเงิน" value={fmtMoney(sale.received)} />
            <MoneyRow label="เงินทอน" value={fmtMoney(sale.changeAmt)} />
          </>
        )}
        {(sale.pointsEarned ?? 0) > 0 && (
          <MoneyRow label="แต้มที่ได้รับ" value={`+${sale.pointsEarned}`} />
        )}
        {(sale.pointsRedeemed ?? 0) > 0 && (
          <MoneyRow label="แต้มที่ใช้" value={`-${sale.pointsRedeemed}`} />
        )}
        {isReturn && (sale.pointsRedeemed ?? 0) < 0 && (
          <MoneyRow
            label="คืนแต้มที่เคยใช้"
            value={`+${Math.abs(sale.pointsRedeemed ?? 0)}`}
          />
        )}
        {isReturn && (sale.pointsEarned ?? 0) < 0 && (
          <MoneyRow
            label="หักแต้มที่เคยได้รับ"
            value={`-${Math.abs(sale.pointsEarned ?? 0)}`}
          />
        )}
      </div>

      {/* หมายเหตุท้ายใบเสร็จ */}
      <div className="mt-2 text-xs space-y-0.5">
        {isReturn && sale.returnReason && (
          <div>เหตุผลคืนสินค้า: {sale.returnReason}</div>
        )}
        <div>* ราคานี้รวมภาษีมูลค่าเพิ่มแล้ว</div>
        {!isReturn && (
          <div>
            ** ต้องการใบกำกับภาษีเต็มรูป โปรดแจ้งเจ้าหน้าที่พร้อมใบเสร็จฉบับนี้
          </div>
        )}
      </div>
      <div className="text-center text-xs mt-2">
        {isReturn ? "ดำเนินการคืนสินค้าเรียบร้อยแล้ว" : "ขอบคุณที่ใช้บริการ"}
      </div>
    </div>
  );
}
