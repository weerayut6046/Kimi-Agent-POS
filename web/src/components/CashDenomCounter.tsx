import { CASH_DENOMINATIONS, sumCashCounts } from "@contracts/cash";
import { Input } from "@/components/ui/input";
import { fmtMoney, cashDenomLabel } from "@/lib/format";

interface Props {
  /** key = มูลค่าแบงก์/เหรียญ (string) → จำนวนที่พิมพ์ (อาจเป็นค่าว่าง) */
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}

/** ตารางนับเงินสดแยกแบงก์/เหรียญ ใช้ตอนปิดกะ — รวมยอดให้อัตโนมัติ */
export default function CashDenomCounter({ value, onChange }: Props) {
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) numeric[k] = Number(v) || 0;
  const total = sumCashCounts(numeric);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {CASH_DENOMINATIONS.map((d) => {
          const key = String(d);
          const n = Number(value[key]) || 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 shrink-0">{cashDenomLabel(d)}</span>
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="0"
                value={value[key] ?? ""}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                className="h-9 w-20"
              />
              <span className="text-xs text-muted-foreground">×</span>
              <span className="text-sm w-24 text-right font-medium">฿{fmtMoney(d * n)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between items-center border-t pt-2">
        <span className="font-medium text-sm">รวมเงินสดที่นับได้</span>
        <span className="font-heading text-lg font-semibold text-green-700">฿{fmtMoney(total)}</span>
      </div>
    </div>
  );
}
