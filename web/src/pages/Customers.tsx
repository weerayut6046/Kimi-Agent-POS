import { useEffect, useRef, useState } from "react";
import { Building2, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { CreditAccountRequestDoc } from "@/components/CreditAccountRequestDoc";
import { ScaledFit } from "@/components/TaxInvoiceDialog";
import { printA4FormElement } from "@/lib/printDoc";
import type { Customer } from "@db/schema";

type CustForm = {
  id?: number;
  name: string;
  taxId: string;
  branchType: "hq" | "branch";
  branchNo: string;
  address: string;
  phone: string;
  vehiclePlate: string;
  creditLimit: string;
};

const emptyForm: CustForm = {
  name: "",
  taxId: "",
  branchType: "hq",
  branchNo: "",
  address: "",
  phone: "",
  vehiclePlate: "",
  creditLimit: "",
};

function formFromCustomer(c: Customer): CustForm {
  const m = c.branch.match(/^สาขาที่\s*(.*)$/);
  return {
    id: c.id,
    name: c.name,
    taxId: c.taxId,
    branchType: m ? "branch" : "hq",
    branchNo: m?.[1] ?? "",
    address: c.address ?? "",
    phone: c.phone,
    vehiclePlate: c.vehiclePlate,
    creditLimit: c.creditLimit > 0 ? String(c.creditLimit) : "",
  };
}

export default function Customers() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const utils = trpc.useUtils();

  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<CustForm | null>(null);
  const [err, setErr] = useState("");
  const [printCust, setPrintCust] = useState<Customer | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: rows, isLoading } = trpc.customers.list.useQuery({
    q: search || undefined,
  });
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();

  const invalidate = () => utils.customers.list.invalidate();
  const create = trpc.customers.create.useMutation({
    onSuccess: () => {
      invalidate();
      setEdit(null);
    },
    onError: e => setErr(e.message),
  });
  const update = trpc.customers.update.useMutation({
    onSuccess: () => {
      invalidate();
      setEdit(null);
    },
    onError: e => setErr(e.message),
  });
  const remove = trpc.customers.remove.useMutation({
    onSuccess: () => invalidate(),
    onError: e => setErr(e.message),
  });

  const submit = () => {
    if (!edit) return;
    const payload = {
      name: edit.name.trim(),
      taxId: edit.taxId.trim(),
      branch:
        edit.branchType === "hq"
          ? "สำนักงานใหญ่"
          : `สาขาที่ ${edit.branchNo.trim()}`,
      address: edit.address.trim(),
      phone: edit.phone.trim(),
      vehiclePlate: edit.vehiclePlate.trim(),
      creditLimit: Math.max(0, Number(edit.creditLimit) || 0),
    };
    if (edit.id) update.mutate({ id: edit.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-heading flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" /> ลูกค้า
        </h1>
        {canManage && (
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              setErr("");
              setEdit({ ...emptyForm });
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> เพิ่มลูกค้า
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="ค้นหา ชื่อ / เลขผู้เสียภาษี / โทรศัพท์ / ทะเบียนรถ"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ชื่อลูกค้า</TableHead>
                <TableHead>เลขผู้เสียภาษี</TableHead>
                <TableHead>สาขา</TableHead>
                <TableHead>โทรศัพท์</TableHead>
                <TableHead>ทะเบียนรถ</TableHead>
                {canManage && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{c.name}</div>
                    {c.address && (
                      <div className="text-xs text-muted-foreground whitespace-pre-line">
                        {c.address}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.taxId || "-"}
                  </TableCell>
                  <TableCell className="text-sm">{c.branch || "-"}</TableCell>
                  <TableCell className="text-sm">{c.phone || "-"}</TableCell>
                  <TableCell className="text-sm">
                    {c.vehiclePlate || "-"}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="พิมพ์ใบขอเปิดบัญชีเครดิต"
                          onClick={() => setPrintCust(c)}
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="แก้ไข"
                          onClick={() => {
                            setErr("");
                            setEdit(formFromCustomer(c));
                          }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          title="ลบ"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (confirm(`ยืนยันลบลูกค้า "${c.name}"?`))
                              remove.mutate({ id: c.id });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!isLoading && (rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="text-center text-muted-foreground py-8"
                  >
                    {search ? "ไม่พบลูกค้าที่ค้นหา" : "ยังไม่มีข้อมูลลูกค้า"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog เพิ่ม/แก้ไขลูกค้า */}
      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {edit?.id ? "แก้ไขลูกค้า" : "เพิ่มลูกค้า"}
            </DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>
                  ชื่อลูกค้า / บริษัท{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  autoFocus
                  value={edit.name}
                  onChange={e => setEdit({ ...edit, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>เลขประจำตัวผู้เสียภาษี</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={13}
                    value={edit.taxId}
                    onChange={e => setEdit({ ...edit, taxId: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>โทรศัพท์</Label>
                  <Input
                    inputMode="tel"
                    value={edit.phone}
                    onChange={e => setEdit({ ...edit, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>สาขา</Label>
                <div className="flex items-center gap-4">
                  <RadioGroup
                    className="flex gap-4"
                    value={edit.branchType}
                    onValueChange={v =>
                      setEdit({ ...edit, branchType: v as "hq" | "branch" })
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="hq" id="c-hq" />
                      <Label htmlFor="c-hq" className="font-normal">
                        สำนักงานใหญ่
                      </Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="branch" id="c-branch" />
                      <Label htmlFor="c-branch" className="font-normal">
                        สาขาที่
                      </Label>
                    </div>
                  </RadioGroup>
                  {edit.branchType === "branch" && (
                    <Input
                      className="w-28"
                      placeholder="เช่น 00078"
                      value={edit.branchNo}
                      onChange={e =>
                        setEdit({ ...edit, branchNo: e.target.value })
                      }
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>ที่อยู่</Label>
                <Textarea
                  rows={2}
                  value={edit.address}
                  onChange={e => setEdit({ ...edit, address: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>ทะเบียนรถ (ถ้ามี)</Label>
                <Input
                  placeholder="เช่น 3กข1955 กรุงเทพมหานคร"
                  value={edit.vehiclePlate}
                  onChange={e =>
                    setEdit({ ...edit, vehiclePlate: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>วงเงินเครดิต (0 = ไม่จำกัด)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  value={edit.creditLimit}
                  onChange={e =>
                    setEdit({ ...edit, creditLimit: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              className="w-full"
              disabled={
                !edit?.name.trim() || create.isPending || update.isPending
              }
              onClick={submit}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog พรีวิว/พิมพ์ใบขอเปิดบัญชีลูกค้าเครดิต */}
      <Dialog open={!!printCust} onOpenChange={o => !o && setPrintCust(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Printer className="w-5 h-5 text-primary" />
              ใบขอเปิดบัญชีลูกค้าเครดิต
            </DialogTitle>
          </DialogHeader>
          {printCust && (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ScaledFit>
                  <div ref={printRef}>
                    <CreditAccountRequestDoc
                      customer={printCust}
                      staffName={staff?.name}
                      settingMap={settingMap}
                      logoUrl={logoUrl}
                    />
                  </div>
                </ScaledFit>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const doc = printRef.current?.firstElementChild;
                    if (doc instanceof HTMLElement) printA4FormElement(doc);
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์ (A4)
                </Button>
                <Button onClick={() => setPrintCust(null)}>ปิด</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
