import { useState } from "react";
import { Banknote, Pencil, Plus, ReceiptText, Trash2 } from "lucide-react";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { fmtMoney, fmtTime } from "@/lib/format";
import type { Expense } from "@db/schema";

/** วันนี้ในรูปแบบ YYYY-MM-DD (local — ห้ามใช้ toISOString เพราะจะเป็น UTC) */
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

type ExpForm = {
  id?: number;
  title: string;
  category: string;
  amount: string;
  note: string;
};

const emptyForm: ExpForm = { title: "", category: "", amount: "", note: "" };

function formFromExpense(e: Expense): ExpForm {
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    amount: String(e.amount),
    note: e.note ?? "",
  };
}

export default function Expenses() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const utils = trpc.useUtils();

  const [date, setDate] = useState(todayStr());
  const [edit, setEdit] = useState<ExpForm | null>(null);
  const [err, setErr] = useState("");

  const { data, isLoading } = trpc.expenses.list.useQuery({
    date: date || undefined,
  });
  const items = data?.items ?? [];

  const invalidate = () => utils.expenses.list.invalidate();
  const create = trpc.expenses.create.useMutation({
    onSuccess: () => {
      invalidate();
      setEdit(null);
    },
    onError: e => setErr(e.message),
  });
  const update = trpc.expenses.update.useMutation({
    onSuccess: () => {
      invalidate();
      setEdit(null);
    },
    onError: e => setErr(e.message),
  });
  const remove = trpc.expenses.remove.useMutation({
    onSuccess: () => invalidate(),
    onError: e => setErr(e.message),
  });

  const amountNum = Number(edit?.amount) || 0;
  const valid = !!edit?.title.trim() && amountNum > 0;

  const submit = () => {
    if (!edit || !valid) return;
    const payload = {
      title: edit.title.trim(),
      category: edit.category.trim(),
      amount: amountNum,
      note: edit.note.trim() || undefined,
    };
    if (edit.id) update.mutate({ id: edit.id, ...payload });
    else create.mutate({ ...payload, staffName: staff?.name ?? "" });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-heading flex items-center gap-2">
          <Banknote className="w-6 h-6 text-primary" /> ค่าใช้จ่ายหน้าร้าน
        </h1>
        <Button
          className="w-full sm:w-auto"
          onClick={() => {
            setErr("");
            setEdit({ ...emptyForm });
          }}
        >
          <Plus className="w-4 h-4 mr-1" /> บันทึกค่าใช้จ่าย
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="w-full space-y-1 sm:w-auto">
          <Label htmlFor="exp-date" className="text-xs text-muted-foreground">
            วันที่
          </Label>
          <Input
            id="exp-date"
            type="date"
            className="w-full sm:w-44"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <Card className="min-w-0 flex-1 basis-full sm:min-w-[200px] sm:basis-auto">
          <CardContent className="py-3 flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              รวมค่าใช้จ่าย {date || "ทั้งหมด"} ({items.length} รายการ)
            </span>
            <span className="text-xl font-bold text-destructive">
              ฿{fmtMoney(data?.total ?? 0)}
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
                <TableHead>พนักงาน</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                {canManage && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">
                    {fmtTime(e.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {e.title}
                  </TableCell>
                  <TableCell className="text-sm">{e.category || "-"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    ฿{fmtMoney(e.amount)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.staffName || "-"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.note || "-"}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="แก้ไข"
                          onClick={() => {
                            setErr("");
                            setEdit(formFromExpense(e));
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
                            if (
                              confirm(
                                `ยืนยันลบค่าใช้จ่าย "${e.title}" ฿${fmtMoney(e.amount)}?`
                              )
                            ) {
                              remove.mutate({ id: e.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 7 : 6}
                    className="text-center text-muted-foreground py-8"
                  >
                    ไม่มีค่าใช้จ่าย{date ? "ของวันนี้" : ""}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog บันทึก/แก้ไขค่าใช้จ่าย */}
      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Banknote className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Expense
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {edit?.id ? "แก้ไขค่าใช้จ่าย" : "บันทึกค่าใช้จ่าย"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  บันทึกรายการค่าใช้จ่ายหน้าร้าน พร้อมจำนวนเงินและหมวดหมู่
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {edit && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <ReceiptText className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      รายละเอียดค่าใช้จ่าย
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อรายการ หมวดหมู่ และจำนวนเงิน
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      รายการ <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      autoFocus
                      placeholder="เช่น ค่าน้ำแข็ง, ค่าถุง, ค่าแรงชั่วคราว"
                      value={edit.title}
                      onChange={e => setEdit({ ...edit, title: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      หมวด
                    </Label>
                    <Input
                      placeholder="เช่น วัตถุดิบ, สาธารณูปโภค"
                      value={edit.category}
                      onChange={e =>
                        setEdit({ ...edit, category: e.target.value })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      จำนวนเงิน (บาท){" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      value={edit.amount}
                      onChange={e =>
                        setEdit({ ...edit, amount: e.target.value })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      หมายเหตุ
                    </Label>
                    <Textarea
                      rows={2}
                      value={edit.note}
                      onChange={e => setEdit({ ...edit, note: e.target.value })}
                      className="bg-white"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={!valid || create.isPending || update.isPending}
              onClick={submit}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
