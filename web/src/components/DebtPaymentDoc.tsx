import { fmtMoney, fmtDateTimeTH, debtMethodLabel } from "@/lib/format";

type Props = {
  payment: {
    paymentNo: string;
    amount: number;
    method: string;
    staffName: string;
    note: string | null;
    createdAt: Date | string;
  };
  customerName: string;
  settingMap?: Record<string, string>;
  logoUrl?: string | null;
};

/** ใบรับชำระหนี้ (แบบใบเสร็จม้วน) — พิมพ์หลังรับชำระหนี้จากหน้าลูกหนี้เครดิต */
export function DebtPaymentDoc({ payment, customerName, settingMap, logoUrl }: Props) {
  return (
    <div className="text-sm font-mono">
      {/* หัวใบ — กึ่งกลางทั้งหมด */}
      <div className="text-center space-y-0.5">
        {logoUrl && <img src={logoUrl} alt="โลโก้ร้าน" className="h-12 w-auto object-contain mx-auto mb-1" />}
        <div className="font-bold text-base">
          {settingMap?.shop_name}
          {settingMap?.shop_branch ? ` สาขา ${settingMap.shop_branch}` : ""}
        </div>
        {settingMap?.shop_address && <div className="text-xs whitespace-pre-line">{settingMap.shop_address}</div>}
        <div className="text-xs">โทร. {settingMap?.shop_phone}</div>
        <div className="font-bold pt-1">ใบรับชำระหนี้</div>
      </div>

      {/* ข้อมูลการรับชำระ */}
      <div className="mt-2 text-xs space-y-0.5">
        <div>เลขที่ : {payment.paymentNo}</div>
        <div>วันที่ : {fmtDateTimeTH(payment.createdAt)}</div>
        <div>ลูกค้า : {customerName}</div>
        {payment.staffName && <div>พนักงาน : {payment.staffName}</div>}
      </div>

      {/* ยอดเงิน */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <div className="flex justify-between gap-2 font-bold">
          <span>ยอดรับชำระ</span>
          <span>{fmtMoney(payment.amount)}</span>
        </div>
        <div className="flex justify-between gap-2 text-xs">
          <span>ชำระโดย</span>
          <span>{debtMethodLabel[payment.method] ?? payment.method}</span>
        </div>
        {payment.note && <div className="text-xs">หมายเหตุ : {payment.note}</div>}
      </div>

      <div className="text-center text-xs mt-2">ขอบคุณที่ใช้บริการ</div>
    </div>
  );
}
