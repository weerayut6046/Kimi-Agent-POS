import { useRef, useState } from "react";
import {
  FileSignature,
  Printer,
  Search,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { CreditAccountRequestDoc } from "@/components/CreditAccountRequestDoc";
import { VehicleFleetDoc } from "@/components/VehicleFleetDoc";
import { ScaledFit } from "@/components/TaxInvoiceDialog";
import { printA4FormElement } from "@/lib/printDoc";
import type { Customer } from "@db/schema";

type DocKey = "credit-request" | "vehicle-fleet";

const DOCS: { key: DocKey; icon: LucideIcon; title: string; desc: string }[] = [
  {
    key: "credit-request",
    icon: FileSignature,
    title: "ใบขอเปิดบัญชีลูกค้าเครดิต",
    desc: "แบบฟอร์มการขอเปิดเครดิตเติมน้ำมัน พร้อมเงื่อนไขการชำระเงิน เอกสารแนบ และลายเซ็น",
  },
  {
    key: "vehicle-fleet",
    icon: Truck,
    title: "รายการรถบรรทุก/เครื่องจักร",
    desc: "แบบฟอร์มรายการรถบรรทุก/เครื่องจักรที่ใช้งาน ประกอบการขอเปิดเครดิต",
  },
];

export default function Documents() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const [openDoc, setOpenDoc] = useState<DocKey | null>(null);
  const [cust, setCust] = useState<Customer | null>(null);
  const [q, setQ] = useState("");
  const docRef = useRef<HTMLDivElement>(null);

  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();
  const { data: custResults } = trpc.customers.list.useQuery(
    { q: q || undefined, limit: 8 },
    { enabled: canManage && openDoc != null && cust == null }
  );

  const active = DOCS.find(d => d.key === openDoc);

  const close = () => {
    setOpenDoc(null);
    setCust(null);
    setQ("");
  };

  if (!canManage) {
    return (
      <div className="py-16 text-center space-y-2">
        <FileSignature className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="font-heading text-xl font-semibold">
          เฉพาะผู้จัดการสาขาและผู้ดูแลระบบ
        </h1>
        <p className="text-sm text-muted-foreground">
          หน้าเอกสารสงวนไว้สำหรับจัดการลูกค้าเครดิตเท่านั้น
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="page-heading flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-primary" /> เอกสาร
        </h1>
        <p className="text-sm text-muted-foreground">
          แบบฟอร์มสำหรับพิมพ์ให้ลูกค้ากรอกและเซ็น ขนาด A4
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DOCS.map(d => (
          <button
            key={d.key}
            type="button"
            className="text-left"
            onClick={() => setOpenDoc(d.key)}
          >
            <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
              <CardContent className="pt-5 space-y-2">
                <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                  <d.icon className="size-5" />
                </div>
                <div className="font-semibold">{d.title}</div>
                <div className="text-sm text-muted-foreground">{d.desc}</div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Dialog open={!!openDoc} onOpenChange={o => !o && close()}>
        <DialogContent
          className={
            cust
              ? "max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
              : "max-w-md"
          }
        >
          <DialogHeader>
            <DialogTitle className="font-heading">{active?.title}</DialogTitle>
          </DialogHeader>

          {openDoc && !cust && (
            <div className="space-y-3">
              <Label>เลือกลูกค้าเครดิตที่จะออกเอกสาร</Label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  className="pl-9"
                  placeholder="ค้นหา ชื่อ / เลขผู้เสียภาษี / ทะเบียนรถ"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                />
              </div>
              <div className="border rounded-lg divide-y text-sm max-h-72 overflow-y-auto">
                {(custResults ?? []).map(c => (
                  <button
                    type="button"
                    key={c.id}
                    className="w-full text-left px-3 py-2 hover:bg-accent"
                    onClick={() => setCust(c)}
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[c.taxId, c.branch].filter(Boolean).join(" · ") || "-"}
                    </div>
                  </button>
                ))}
                {(custResults ?? []).length === 0 && (
                  <div className="px-3 py-6 text-center text-muted-foreground">
                    ไม่พบลูกค้า
                  </div>
                )}
              </div>
            </div>
          )}

          {openDoc && cust && (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ScaledFit>
                  <div ref={docRef}>
                    {openDoc === "credit-request" ? (
                      <CreditAccountRequestDoc
                        customer={cust}
                        staffName={staff?.name}
                        settingMap={settingMap}
                        logoUrl={logoUrl}
                      />
                    ) : (
                      <VehicleFleetDoc
                        customer={cust}
                        staffName={staff?.name}
                        settingMap={settingMap}
                        logoUrl={logoUrl}
                      />
                    )}
                  </div>
                </ScaledFit>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="ghost" onClick={() => setCust(null)}>
                  เปลี่ยนลูกค้า
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const doc = docRef.current?.firstElementChild;
                    if (doc instanceof HTMLElement) printA4FormElement(doc);
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์ (A4)
                </Button>
                <Button onClick={close}>ปิด</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
