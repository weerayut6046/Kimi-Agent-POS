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
  paymentQrUrl?: string | null;
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
    <div
      className={`flex items-start justify-between gap-3${bold ? " font-bold" : ""}`}
    >
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** ใบเสร็จรับเงินแบบม้วน ใช้ร่วมกันทั้ง POS, ประวัติการขาย และ Production */
export function ReceiptDoc({
  sale,
  items,
  settingMap,
  staffName,
  logoUrl,
  paymentQrUrl,
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
  const showPaymentQr =
    !isReturn && sale.paymentMethod === "qr" && Boolean(paymentQrUrl);

  return (
    <div className="receipt-doc bg-white px-4 py-5 font-mono text-sm text-black sm:px-5">
      <header className="text-center">
        {logoUrl && (
          <img
            src={logoUrl}
            alt="โลโก้ร้าน"
            className="receipt-logo mx-auto mb-2 h-14 w-auto object-contain"
          />
        )}
        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-500">
          Official receipt
        </div>
        <div className="mt-1 text-lg font-black leading-tight">
          {settingMap?.shop_name}
        </div>
        {settingMap?.shop_branch && (
          <div className="mt-0.5 text-xs font-bold">
            สาขา {settingMap.shop_branch}
          </div>
        )}
        {settingMap?.shop_address && (
          <div className="mx-auto mt-1 max-w-[95%] whitespace-pre-line text-[11px] leading-relaxed text-slate-700">
            {settingMap.shop_address}
          </div>
        )}
        {settingMap?.shop_phone && (
          <div className="mt-0.5 text-[11px]">โทร. {settingMap.shop_phone}</div>
        )}
        <div className="mt-3 border-y-2 border-black py-1.5 text-sm font-black tracking-wide">
          {isReturn
            ? "ใบรับคืนสินค้า/ใบคืนเงิน"
            : "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ"}
        </div>
        {settingMap?.tax_id && (
          <div className="mt-1 text-[10px]">
            เลขประจำตัวผู้เสียภาษี {settingMap.tax_id}
          </div>
        )}
      </header>

      <section className="mt-3 space-y-1 border-b border-dashed border-black pb-2 text-xs">
        <div className="flex justify-between gap-3 font-bold">
          <span>เลขที่บิล</span>
          <span className="break-all text-right">{sale.receiptNo}</span>
        </div>
        {isReturn && sale.originalReceiptNo && (
          <div className="flex justify-between gap-3">
            <span>อ้างอิงบิล</span>
            <span className="text-right">{sale.originalReceiptNo}</span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span>วันที่</span>
          <span className="text-right">{fmtDateTimeTH(sale.createdAt)}</span>
        </div>
        {staffName && (
          <div className="flex justify-between gap-3">
            <span>พนักงาน</span>
            <span className="text-right">{staffName}</span>
          </div>
        )}
        {sale.memberName && (
          <div className="flex justify-between gap-3">
            <span>สมาชิก</span>
            <span className="text-right">{sale.memberName}</span>
          </div>
        )}
        {sale.paymentMethod === "credit" && sale.customerName && (
          <div className="flex justify-between gap-3">
            <span>ลูกค้า</span>
            <span className="text-right">{sale.customerName}</span>
          </div>
        )}
      </section>

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-[11px] uppercase tracking-wide">
            <th className="py-1.5 text-left font-black">รายการ</th>
            <th className="w-14 py-1.5 text-center font-black">จำนวน</th>
            <th className="w-24 py-1.5 text-right font-black">รวม</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={index}
              className="align-top last:border-b last:border-dashed last:border-black"
            >
              <td className="break-words py-1.5 pr-2 font-semibold leading-snug">
                <span>{item.name}</span>
                <span className="mt-0.5 block text-[10px] font-normal text-slate-600">
                  {fmtMoney(item.unitPrice)} บาท/{item.unit}
                </span>
              </td>
              <td className="whitespace-nowrap py-1.5 text-center tabular-nums">
                {fmtNum(isReturn ? Math.abs(item.qty) : item.qty)}
              </td>
              <td className="whitespace-nowrap py-1.5 text-right font-bold tabular-nums">
                {fmtMoney(isReturn ? Math.abs(item.amount) : item.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-2 space-y-1 text-xs">
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
            <div className="text-[10px]">
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
            <div className="text-[10px]">
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
          label={`ภาษีมูลค่าเพิ่ม ${fmtNum(sale.vatRate)}% (รวมใน)`}
          value={fmtMoney(isReturn ? Math.abs(sale.vatAmount) : sale.vatAmount)}
        />
        <div className="mt-2 flex items-end justify-between gap-3 border-y-2 border-black py-2">
          <span className="text-sm font-black">
            {isReturn ? "ยอดคืนเงิน" : "ยอดสุทธิ"}
          </span>
          <span className="text-xl font-black tabular-nums">
            ฿{fmtMoney(isReturn ? Math.abs(sale.total) : sale.total)}
          </span>
        </div>
      </section>

      <section className="mt-2 rounded-lg border border-black px-2.5 py-2 text-xs">
        <MoneyRow
          label={isReturn ? "คืนเงินโดย" : "ชำระโดย"}
          value={paymentLabel[sale.paymentMethod] ?? sale.paymentMethod}
          bold
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
      </section>

      {showPaymentQr && (
        <section className="receipt-payment-qr-block mt-3 border-y-2 border-dashed border-black py-3 text-center">
          <div className="text-sm font-black">สแกน QR เพื่อชำระเงิน</div>
          <div className="mt-0.5 text-[10px]">รองรับทุกแอปธนาคาร</div>
          <img
            src={paymentQrUrl ?? undefined}
            alt={`QR พร้อมเพย์ ยอด ${fmtMoney(sale.total)} บาท`}
            className="receipt-payment-qr mx-auto my-2 size-40 bg-white object-contain"
          />
          <div className="text-base font-black tabular-nums">
            ยอดชำระ ฿{fmtMoney(sale.total)}
          </div>
          <div className="mt-0.5 text-[10px]">อ้างอิงบิล {sale.receiptNo}</div>
          <div className="mt-1 text-[10px] leading-relaxed">
            กรุณาตรวจสอบชื่อผู้รับและยอดเงินในแอปธนาคารก่อนยืนยัน
          </div>
        </section>
      )}

      <footer className="mt-3 space-y-1 text-[10px] leading-relaxed">
        {isReturn && sale.returnReason && (
          <div className="font-bold">เหตุผลคืนสินค้า: {sale.returnReason}</div>
        )}
        <div>* ราคานี้รวมภาษีมูลค่าเพิ่มแล้ว</div>
        {!isReturn && (
          <div>
            ** ต้องการใบกำกับภาษีเต็มรูป โปรดแจ้งเจ้าหน้าที่พร้อมใบเสร็จฉบับนี้
          </div>
        )}
        <div className="pt-2 text-center text-xs font-bold">
          {isReturn
            ? "ดำเนินการคืนสินค้าเรียบร้อยแล้ว"
            : "ขอบคุณที่ใช้บริการ • เดินทางปลอดภัย"}
        </div>
      </footer>
    </div>
  );
}
