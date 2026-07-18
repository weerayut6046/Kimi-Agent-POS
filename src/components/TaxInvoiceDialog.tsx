import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, Pencil, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDoc } from "@/components/TaxInvoiceDoc";
import { printElement } from "@/lib/printDoc";
import type { TaxInvoice } from "@db/schema";

type Props = {
  saleId: number | null;
  onClose: () => void;
  /** false = ซ่อนปุ่มแก้ไขข้อมูลลูกค้า (ใช้ในหน้ารายการใบกำกับภาษีสำหรับผู้ที่ไม่ใช่ admin) */
  canEdit?: boolean;
};

/** ย่อเนื้อหาที่กว้างคงที่ (เอกสาร A4 210mm) ให้พอดีความกว้างที่มี ด้วย transform scale */
function ScaledFit({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const ro = new ResizeObserver(() => {
      const s = Math.min(1, outer.clientWidth / inner.offsetWidth);
      setScale(s);
      setHeight(inner.offsetHeight * s);
    });
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      className="w-full overflow-hidden"
      style={height != null ? { height } : undefined}
    >
      <div
        ref={innerRef}
        className="w-fit mx-auto"
        style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

type FormState = {
  customerName: string;
  customerTaxId: string;
  branchType: "hq" | "branch";
  branchNo: string;
  customerAddress: string;
  customerPhone: string;
  vehiclePlate: string;
};

function formFromInvoice(inv: TaxInvoice | null, memberName: string | null): FormState {
  if (!inv) {
    return {
      customerName: memberName ?? "",
      customerTaxId: "",
      branchType: "hq",
      branchNo: "",
      customerAddress: "",
      customerPhone: "",
      vehiclePlate: "",
    };
  }
  const branchMatch = inv.customerBranch.match(/^สาขาที่\s*(.*)$/);
  return {
    customerName: inv.customerName,
    customerTaxId: inv.customerTaxId,
    branchType: branchMatch ? "branch" : "hq",
    branchNo: branchMatch?.[1] ?? "",
    customerAddress: inv.customerAddress ?? "",
    customerPhone: inv.customerPhone,
    vehiclePlate: inv.vehiclePlate,
  };
}

/** ฟอร์มข้อมูลลูกค้าสำหรับออกใบกำกับภาษีเต็มรูป (remount ด้วย key ทุกครั้งที่ initial เปลี่ยน) */
function TaxInvoiceForm({
  saleId,
  initial,
  onSaved,
  onCancel,
}: {
  saleId: number;
  initial: FormState;
  onSaved: () => void;
  onCancel: (() => void) | null;
}) {
  const { staff } = useStaff();
  const utils = trpc.useUtils();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const set = (k: keyof FormState, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = trpc.taxInvoice.save.useMutation({
    onSuccess: () => {
      utils.taxInvoice.bySale.invalidate({ saleId });
      utils.taxInvoice.list.invalidate();
      onSaved();
    },
    onError: (e) => setErr(e.message),
  });

  const submit = () => {
    save.mutate({
      saleId,
      customerName: f.customerName.trim(),
      customerTaxId: f.customerTaxId.trim(),
      customerBranch: f.branchType === "hq" ? "สำนักงานใหญ่" : `สาขาที่ ${f.branchNo.trim()}`,
      customerAddress: f.customerAddress.trim(),
      customerPhone: f.customerPhone.trim(),
      vehiclePlate: f.vehiclePlate.trim(),
      issuedBy: staff?.name ?? "",
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>ชื่อลูกค้า / บริษัท <span className="text-destructive">*</span></Label>
        <Input autoFocus value={f.customerName} onChange={(e) => set("customerName", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>เลขประจำตัวผู้เสียภาษี</Label>
          <Input inputMode="numeric" maxLength={13} value={f.customerTaxId} onChange={(e) => set("customerTaxId", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>โทรศัพท์</Label>
          <Input inputMode="tel" value={f.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>สาขา</Label>
        <div className="flex items-center gap-4">
          <RadioGroup
            className="flex gap-4"
            value={f.branchType}
            onValueChange={(v) => set("branchType", v)}
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="hq" id="ti-hq" />
              <Label htmlFor="ti-hq" className="font-normal">สำนักงานใหญ่</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="branch" id="ti-branch" />
              <Label htmlFor="ti-branch" className="font-normal">สาขาที่</Label>
            </div>
          </RadioGroup>
          {f.branchType === "branch" && (
            <Input className="w-28" placeholder="เช่น 00078" value={f.branchNo} onChange={(e) => set("branchNo", e.target.value)} />
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>ที่อยู่</Label>
        <Textarea rows={2} value={f.customerAddress} onChange={(e) => set("customerAddress", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>ทะเบียนรถ (ถ้ามี)</Label>
        <Input placeholder="เช่น 3กข1955 กรุงเทพมหานคร" value={f.vehiclePlate} onChange={(e) => set("vehiclePlate", e.target.value)} />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <DialogFooter className="gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}>ยกเลิก</Button>}
        <Button disabled={!f.customerName.trim() || save.isPending} onClick={submit}>
          <FileText className="w-4 h-4 mr-2" /> บันทึกและดูใบกำกับภาษี
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Dialog ออก/พิมพ์ใบเสร็จรับเงิน-ใบกำกับภาษีเต็มรูป สำหรับบิลที่ขายแล้ว */
export function TaxInvoiceDialog({ saleId, onClose, canEdit = true }: Props) {
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: detail } = trpc.pos.saleDetail.useQuery(
    { id: saleId! },
    { enabled: saleId != null },
  );
  const { data: invoice, isLoading: invLoading } = trpc.taxInvoice.bySale.useQuery(
    { saleId: saleId! },
    { enabled: saleId != null },
  );

  const [editing, setEditing] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setEditing(false);
    onClose();
  };

  const showForm = !invLoading && (!invoice || editing);
  const ready = detail && invoice && !showForm;

  return (
    <Dialog open={saleId != null} onOpenChange={(o) => !o && close()}>
      <DialogContent className={showForm ? "max-w-md" : "max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            ใบเสร็จรับเงิน/ใบกำกับภาษีเต็มรูป
          </DialogTitle>
        </DialogHeader>

        {saleId != null && (!detail || invLoading) && (
          <p className="text-sm text-muted-foreground py-6 text-center">กำลังโหลด...</p>
        )}

        {saleId != null && detail && showForm && (
          <TaxInvoiceForm
            key={invoice ? `inv-${invoice.id}` : "new"}
            saleId={saleId}
            initial={formFromInvoice(invoice ?? null, detail.memberName)}
            onSaved={() => setEditing(false)}
            onCancel={invoice ? () => setEditing(false) : null}
          />
        )}

        {ready && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ScaledFit>
                <div ref={docRef}>
                  <TaxInvoiceDoc sale={detail.sale} items={detail.items} invoice={invoice} settingMap={settingMap} />
                </div>
              </ScaledFit>
            </div>
            <DialogFooter className="gap-2">
              {canEdit && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="w-4 h-4 mr-2" /> แก้ไขข้อมูลลูกค้า
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  const doc = docRef.current?.firstElementChild;
                  if (doc instanceof HTMLElement) printElement(doc);
                }}
              >
                <Printer className="w-4 h-4 mr-2" /> พิมพ์
              </Button>
              <Button onClick={close}>ปิด</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
