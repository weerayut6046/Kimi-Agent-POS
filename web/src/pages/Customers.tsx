import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Contact,
  CreditCard,
  MapPin,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
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
      {err && !edit && <p className="text-sm text-destructive">{err}</p>}

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
        <DialogContent className="flex max-h-[94vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl sm:p-0">
          <div className="shrink-0 border-b border-violet-100 bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-5 py-5 sm:px-7 sm:py-6">
            <DialogHeader className="pr-8 text-left">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-[0_8px_20px_rgba(109,79,246,0.28)]">
                  {edit?.id ? (
                    <Pencil className="size-5" />
                  ) : (
                    <Plus className="size-5" />
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">
                    ข้อมูลลูกค้าธุรกิจ
                  </p>
                  <DialogTitle className="font-heading text-xl leading-tight text-slate-900 sm:text-2xl">
                    {edit?.id ? "แก้ไขลูกค้า" : "เพิ่มลูกค้า"}
                  </DialogTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {edit?.id
                      ? "ปรับปรุงข้อมูลสำหรับการออกเอกสารและขายเชื่อ"
                      : "บันทึกข้อมูลสำหรับการออกเอกสารและขายเชื่อ"}
                  </p>
                </div>
              </div>
            </DialogHeader>
          </div>

          {edit && (
            <form
              className="min-h-0 flex flex-1 flex-col"
              onSubmit={e => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
                <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                  <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                      <Contact className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        ข้อมูลลูกค้า
                      </h3>
                      <p className="text-xs text-slate-500">
                        ชื่อและช่องทางติดต่อ
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="space-y-2">
                      <Label htmlFor="customer-name">
                        ชื่อลูกค้า / บริษัท{" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="customer-name"
                        className="h-11 rounded-xl bg-white shadow-sm"
                        autoFocus
                        required
                        placeholder="ระบุชื่อลูกค้าหรือชื่อบริษัท"
                        value={edit.name}
                        onChange={e =>
                          setEdit({ ...edit, name: e.target.value })
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="customer-tax-id">
                          เลขประจำตัวผู้เสียภาษี
                        </Label>
                        <Input
                          id="customer-tax-id"
                          className="h-11 rounded-xl bg-white font-mono shadow-sm"
                          inputMode="numeric"
                          maxLength={13}
                          placeholder="เลข 13 หลัก"
                          value={edit.taxId}
                          onChange={e =>
                            setEdit({ ...edit, taxId: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="customer-phone">โทรศัพท์</Label>
                        <Input
                          id="customer-phone"
                          className="h-11 rounded-xl bg-white shadow-sm"
                          inputMode="tel"
                          placeholder="เช่น 081-234-5678"
                          value={edit.phone}
                          onChange={e =>
                            setEdit({ ...edit, phone: e.target.value })
                          }
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                  <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                      <MapPin className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        ที่อยู่และสาขา
                      </h3>
                      <p className="text-xs text-slate-500">
                        ใช้สำหรับใบเสร็จและใบกำกับภาษี
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 sm:p-5">
                    <div className="space-y-2">
                      <Label>ประเภทสาขา</Label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
                        <RadioGroup
                          className="grid grid-cols-2 gap-2"
                          value={edit.branchType}
                          onValueChange={v =>
                            setEdit({
                              ...edit,
                              branchType: v as "hq" | "branch",
                            })
                          }
                        >
                          <div
                            className={`flex h-11 items-center gap-2 rounded-xl border px-3 transition-colors ${
                              edit.branchType === "hq"
                                ? "border-violet-400 bg-violet-50 text-violet-800"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            <RadioGroupItem value="hq" id="c-hq" />
                            <Label
                              htmlFor="c-hq"
                              className="flex-1 cursor-pointer font-medium"
                            >
                              สำนักงานใหญ่
                            </Label>
                          </div>
                          <div
                            className={`flex h-11 items-center gap-2 rounded-xl border px-3 transition-colors ${
                              edit.branchType === "branch"
                                ? "border-violet-400 bg-violet-50 text-violet-800"
                                : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            <RadioGroupItem value="branch" id="c-branch" />
                            <Label
                              htmlFor="c-branch"
                              className="flex-1 cursor-pointer font-medium"
                            >
                              สาขา
                            </Label>
                          </div>
                        </RadioGroup>

                        {edit.branchType === "branch" && (
                          <Input
                            aria-label="เลขที่สาขา"
                            className="h-11 rounded-xl bg-white shadow-sm"
                            placeholder="เช่น 00078"
                            value={edit.branchNo}
                            onChange={e =>
                              setEdit({
                                ...edit,
                                branchNo: e.target.value,
                              })
                            }
                          />
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="customer-address">ที่อยู่</Label>
                      <Textarea
                        id="customer-address"
                        className="min-h-24 resize-y rounded-xl bg-white shadow-sm"
                        placeholder="บ้านเลขที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด รหัสไปรษณีย์"
                        value={edit.address}
                        onChange={e =>
                          setEdit({ ...edit, address: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-br from-white via-white to-violet-50 shadow-[0_12px_34px_rgba(109,79,246,0.1)]">
                  <div className="flex items-center gap-2.5 border-b border-violet-100 px-4 py-3.5 sm:px-5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                      <CreditCard className="size-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        ข้อมูลการขายเชื่อ
                      </h3>
                      <p className="text-xs text-slate-500">
                        รถที่ใช้และวงเงินของลูกค้า
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4 sm:gap-4 sm:p-5">
                    <div className="space-y-2">
                      <Label
                        htmlFor="customer-vehicle"
                        className="flex items-center gap-1.5"
                      >
                        <Truck className="size-3.5 text-slate-400" />
                        ทะเบียนรถ{" "}
                        <span className="font-normal text-slate-400">
                          (ถ้ามี)
                        </span>
                      </Label>
                      <Input
                        id="customer-vehicle"
                        className="h-11 rounded-xl bg-white shadow-sm"
                        placeholder="เช่น 3กข 1955 กรุงเทพมหานคร"
                        value={edit.vehiclePlate}
                        onChange={e =>
                          setEdit({
                            ...edit,
                            vehiclePlate: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="customer-credit-limit">
                        วงเงินเครดิต
                      </Label>
                      <div className="relative">
                        <Input
                          id="customer-credit-limit"
                          className="h-11 rounded-xl bg-white pr-12 font-semibold tabular-nums shadow-sm"
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0"
                          value={edit.creditLimit}
                          onChange={e =>
                            setEdit({
                              ...edit,
                              creditLimit: e.target.value,
                            })
                          }
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                          บาท
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        เว้นว่างหรือใส่ 0 = ไม่จำกัด
                      </p>
                    </div>
                  </div>
                </section>

                {err && (
                  <p
                    className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-destructive"
                    role="alert"
                  >
                    {err}
                  </p>
                )}
              </div>

              <DialogFooter className="flex-row items-center justify-end shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  disabled={create.isPending || update.isPending}
                  onClick={() => setEdit(null)}
                >
                  ยกเลิก
                </Button>
                <Button
                  type="submit"
                  className="flex-[1.5] sm:min-w-36 sm:flex-none"
                  disabled={
                    !edit.name.trim() || create.isPending || update.isPending
                  }
                >
                  <Save className="size-4" />
                  {create.isPending || update.isPending
                    ? "กำลังบันทึก..."
                    : "บันทึกข้อมูล"}
                </Button>
              </DialogFooter>
            </form>
          )}
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
