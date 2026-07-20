import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Bell, Fuel, PackageX } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { fmtNum } from "@/lib/format";

/**
 * กระดิ่งแจ้งเตือนถัง/สต็อกใกล้หมด — โพลทุก 15 วินาที แสดง badge จำนวนรายการบนทุกหน้า
 * และเด้ง toast ทันทีที่มีรายการใหม่ต่ำกว่าเกณฑ์ (เช่น ขายน้ำมันไปจนถังต่ำกว่าเกณฑ์)
 */
export default function LowStockAlert() {
  const { data } = trpc.catalog.lowStockAlerts.useQuery(undefined, {
    refetchInterval: 15000,
  });
  // เก็บ id รายการที่รู้แล้ว — null = ยังไม่เคยโหลด (รอบแรกไม่เด้ง toast รัว ๆ ตอนเปิดแอป)
  const knownRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) return;
    const current = new Set<string>([
      ...data.lowTanks.map(t => `tank-${t.id}`),
      ...data.lowProducts.map(p => `prod-${p.id}`),
    ]);
    if (knownRef.current === null) {
      knownRef.current = current;
      return;
    }
    for (const t of data.lowTanks) {
      if (!knownRef.current.has(`tank-${t.id}`)) {
        toast.warning(`${t.name}ใกล้หมด`, {
          description: `เหลือ ${fmtNum(t.currentLiters)} ลิตร (เกณฑ์แจ้งเตือน ${fmtNum(t.lowAlertAt)} ลิตร)`,
        });
      }
    }
    for (const p of data.lowProducts) {
      if (!knownRef.current.has(`prod-${p.id}`)) {
        toast.warning(`${p.name} ใกล้หมดสต็อก`, {
          description: `เหลือ ${fmtNum(p.stockQty)} ${p.unit} (เกณฑ์แจ้งเตือน ${fmtNum(p.lowStockAt)} ${p.unit})`,
        });
      }
    }
    knownRef.current = current;
  }, [data]);

  const count = data?.count ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-lg p-2 text-white/80 hover:bg-white/10 hover:text-white"
          title="แจ้งเตือนสต็อก"
        >
          <Bell className="w-5 h-5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold flex items-center justify-center">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-1.5rem)] max-w-80 p-0"
        align="end"
      >
        <div className="px-4 py-3 border-b font-heading font-semibold text-sm">
          แจ้งเตือนสต็อก
        </div>
        {count === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            ไม่มีรายการแจ้งเตือน
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y">
            {data!.lowTanks.map(t => (
              <div key={t.id} className="px-4 py-2.5 flex items-center gap-3">
                <Fuel className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    เหลือ {fmtNum(t.currentLiters)} / {fmtNum(t.capacityLiters)}{" "}
                    ลิตร
                  </div>
                </div>
              </div>
            ))}
            {data!.lowProducts.map(p => (
              <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                <PackageX className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    เหลือ {fmtNum(p.stockQty)} {p.unit} (เกณฑ์{" "}
                    {fmtNum(p.lowStockAt)})
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="p-2 border-t">
          <Link to="/stock">
            <Button variant="ghost" size="sm" className="w-full">
              ไปหน้าจัดการสต๊อก
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
