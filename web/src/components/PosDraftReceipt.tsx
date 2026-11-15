import { Minus, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { SaleItemValues } from "@contracts/saleItemValues";
import type { Product } from "@db/schema";

type DraftLine = {
  product: Pick<Product, "id" | "name" | "unit" | "category">;
  qty: number;
  values: SaleItemValues;
};

type Props = {
  lines: readonly DraftLine[];
  productById: ReadonlyMap<number, Pick<Product, "stockQty">>;
  subtotal: number;
  promotionDiscount: number;
  pointsDiscount: number;
  total: number;
  onQuantityChange: (productId: number, qty: number) => void;
  onRemove: (productId: number) => void;
};

export function PosDraftReceipt({
  lines,
  productById,
  subtotal,
  promotionDiscount,
  pointsDiscount,
  total,
  onQuantityChange,
  onRemove,
}: Props) {
  return (
    <section
      aria-label="บิลร่าง"
      className="overflow-hidden rounded-xl border border-amber-200 bg-[#fffdf6] text-slate-900 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-amber-300/80 px-3 py-2.5 sm:px-4">
        <h3 className="font-heading text-sm font-bold">บิลร่าง</h3>
        {lines.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
            รอชำระ
          </span>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-600">
          แตะหรือสแกนสินค้าเพื่อเริ่มรายการขาย
        </p>
      ) : (
        <ul className="max-h-[260px] divide-y divide-dashed divide-amber-200 overflow-y-auto px-3 sm:px-4">
          {lines.map(({ product, qty, values }) => {
            const stock = productById.get(product.id)?.stockQty ?? 0;
            const isFuel = product.category === "fuel";
            return (
              <li key={product.id} className="space-y-1.5 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 pt-1">
                    <div className="break-words font-semibold">
                      {product.name}
                      {!isFuel && stock <= 0 && (
                        <Badge className="ml-2 bg-red-100 text-red-700 hover:bg-red-100">
                          หมดแล้ว
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      ฿{fmtMoney(values.unitPrice)} / {product.unit}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`ลบ ${product.name}`}
                    onClick={() => onRemove(product.id)}
                    className="grid size-10 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-red-100 hover:text-red-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center overflow-hidden rounded-lg border border-amber-200 bg-white">
                    <button
                      type="button"
                      aria-label={`ลดจำนวน ${product.name}`}
                      className="grid size-10 shrink-0 place-items-center text-slate-600 hover:bg-amber-50"
                      onClick={() => onQuantityChange(product.id, qty - 1)}
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="min-w-[64px] border-x border-amber-200 px-1.5 text-center text-xs font-semibold number-display">
                      {fmtNum(values.qty)} {product.unit}
                    </span>
                    <button
                      type="button"
                      aria-label={`เพิ่มจำนวน ${product.name}`}
                      disabled={!isFuel && qty >= stock}
                      className="grid size-10 shrink-0 place-items-center text-slate-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                      onClick={() => onQuantityChange(product.id, qty + 1)}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <span className="shrink-0 font-heading font-bold number-display">
                    ฿{fmtMoney(values.amount)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <dl className="space-y-1 border-t border-dashed border-amber-300/80 px-3 py-3 text-sm sm:px-4">
        {lines.length > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-slate-600">ยอดรวมสินค้า</dt>
            <dd className="number-display">฿{fmtMoney(subtotal)}</dd>
          </div>
        )}
        {promotionDiscount > 0 && (
          <div className="flex justify-between gap-2 text-emerald-800">
            <dt>ส่วนลดโปรโมชั่น</dt>
            <dd className="number-display">−฿{fmtMoney(promotionDiscount)}</dd>
          </div>
        )}
        {pointsDiscount > 0 && (
          <div className="flex justify-between gap-2 text-emerald-800">
            <dt>ส่วนลดจากแต้ม</dt>
            <dd className="number-display">−฿{fmtMoney(pointsDiscount)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2 pt-1 font-heading font-bold">
          <dt>ยอดชำระ</dt>
          <dd aria-live="polite" className="text-xl number-display">
            ฿{fmtMoney(total)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
