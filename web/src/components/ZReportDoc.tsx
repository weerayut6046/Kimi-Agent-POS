import { fmtMoney, fmtNum, fmtDateTH, fmtDateTimeTH, paymentLabel, debtMethodLabel } from "@/lib/format";

const PAY_METHODS = ["cash", "qr", "card", "credit"] as const;
const DEBT_METHODS = ["cash", "qr", "transfer"] as const;

type DailyReport = {
  date: string;
  totalSales: number;
  billCount: number;
  voidedCount: number;
  voidedTotal: number;
  discountTotal: number;
  vatTotal: number;
  byMethod: Record<string, { count: number; total: number }>;
  fuelLiters: { name: string; liters: number }[];
  totalLiters: number;
  expenses: {
    items: { id: number; title: string; amount: number }[];
    total: number;
  };
  debtPayments: {
    items: { id: number; paymentNo: string; customerName: string; method: string; amount: number }[];
    total: number;
    byMethod: Record<string, number>;
  };
  expectedCash: number;
};

type Props = {
  report: DailyReport;
  settingMap?: Record<string, string>;
  logoUrl?: string | null;
  printedBy?: string;
  printedAt?: Date;
};

function MoneyRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2${bold ? " font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** รายงานปิดวัน (Z-Report) แบบใบเสร็จม้วน — พิมพ์จากหน้า /reports */
export function ZReportDoc({ report, settingMap, logoUrl, printedBy, printedAt }: Props) {
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
        <div className="font-bold pt-1">รายงานปิดวัน (Z-Report)</div>
        <div className="text-xs">ประจำวันที่ {fmtDateTH(report.date)}</div>
      </div>

      {/* สรุปยอดขาย */}
      <div className="mt-2 pt-1 border-t border-black space-y-0.5">
        <MoneyRow label="ยอดขายรวม" value={fmtMoney(report.totalSales)} bold />
        <MoneyRow label="จำนวนบิล" value={`${report.billCount} บิล`} />
        <MoneyRow
          label="บิลยกเลิก"
          value={`${report.voidedCount} บิล / ${fmtMoney(report.voidedTotal)}`}
        />
        <MoneyRow label="ส่วนลด" value={fmtMoney(report.discountTotal)} />
        <MoneyRow label="ภาษีมูลค่าเพิ่ม (รวมใน)" value={fmtMoney(report.vatTotal)} />
      </div>

      {/* แยกวิธีชำระ */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <div className="font-bold text-xs">แยกตามวิธีชำระ</div>
        {PAY_METHODS.map((m) => (
          <div key={m} className="flex justify-between gap-2 text-xs">
            <span>
              {paymentLabel[m]} ({report.byMethod[m]?.count ?? 0})
            </span>
            <span>{fmtMoney(report.byMethod[m]?.total ?? 0)}</span>
          </div>
        ))}
      </div>

      {/* ลิตรน้ำมัน */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <div className="font-bold text-xs">ปริมาณน้ำมันขาย (ลิตร)</div>
        {report.fuelLiters.length === 0 && <div className="text-xs">— ไม่มีรายการ —</div>}
        {report.fuelLiters.map((f) => (
          <div key={f.name} className="flex justify-between gap-2 text-xs">
            <span>{f.name}</span>
            <span>{fmtNum(f.liters)}</span>
          </div>
        ))}
        <MoneyRow label="รวมลิตร" value={fmtNum(report.totalLiters)} bold />
      </div>

      {/* ค่าใช้จ่าย */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <div className="font-bold text-xs">ค่าใช้จ่ายหน้าร้าน ({report.expenses.items.length} รายการ)</div>
        {report.expenses.items.map((e) => (
          <div key={e.id} className="flex justify-between gap-2 text-xs">
            <span>{e.title}</span>
            <span>{fmtMoney(e.amount)}</span>
          </div>
        ))}
        <MoneyRow label="รวมค่าใช้จ่าย" value={fmtMoney(report.expenses.total)} bold />
      </div>

      {/* รับชำระหนี้ */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <div className="font-bold text-xs">รับชำระหนี้ ({report.debtPayments.items.length} รายการ)</div>
        {report.debtPayments.items.map((p) => (
          <div key={p.id} className="flex justify-between gap-2 text-xs">
            <span>
              {p.customerName}
              <span className="block">{p.paymentNo} · {debtMethodLabel[p.method] ?? p.method}</span>
            </span>
            <span>{fmtMoney(p.amount)}</span>
          </div>
        ))}
        {DEBT_METHODS.map((m) => (
          <div key={m} className="flex justify-between gap-2 text-xs">
            <span>— {debtMethodLabel[m]}</span>
            <span>{fmtMoney(report.debtPayments.byMethod[m] ?? 0)}</span>
          </div>
        ))}
        <MoneyRow label="รวมรับชำระหนี้" value={fmtMoney(report.debtPayments.total)} bold />
      </div>

      {/* เงินสดคาดหวังในลิ้นชัก */}
      <div className="mt-1 pt-1 border-t border-black space-y-0.5">
        <div className="text-xs">= ขายเงินสด + ชำระหนี้เงินสด − ค่าใช้จ่าย</div>
        <div className="flex justify-between gap-2 font-bold text-base">
          <span>เงินสดที่ควรมีในลิ้นชัก</span>
          <span>{fmtMoney(report.expectedCash)}</span>
        </div>
      </div>

      {/* ท้ายใบ */}
      <div className="mt-2 text-xs space-y-0.5 border-t border-black pt-1">
        <div>พิมพ์โดย : {printedBy || "-"}</div>
        <div>เวลาพิมพ์ : {printedAt ? fmtDateTimeTH(printedAt) : "-"}</div>
      </div>
      <div className="text-center text-xs mt-2">*** สิ้นสุดรายงาน ***</div>
    </div>
  );
}
