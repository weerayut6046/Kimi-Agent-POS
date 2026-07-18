import { useState } from "react";
import { Banknote, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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

  const { data, isLoading } = trpc.expenses.list.useQuery({ date: date || undefined });
  const items = data?.items ?? [];

  const invalidate = () => utils.expenses.list.invalidate();
  const create = trpc.expenses.create.useMutation({
    onSuccess: () => { invalidate(); setEdit(null); },
    onError: (e) => setErr(e.message),
  });
  const update = trpc.expenses.update.useMutation({
    onSuccess: () => { invalidate(); setEdit(null); },
    onError: (e) => setErr(e.message),
  });
  const remove = trpc.expenses.remove.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => setErr(e.message),
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
        <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
          <Banknote className="w-6 h-6 text-primary" /> ค่าใช้จ่ายหน้าร้าน
        </h1>
        <Button onClick={() => { setErr(""); setEdit({ ...emptyForm }); }}>
          <Plus className="w-4 h-4 mr-1" /> บันทึกค่าใช้จ่าย
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="space-y-1">
          <Label htmlFor="exp-date" className="text-xs text-muted-foreground">วันที่</Label>
          <Input
            id="exp-date"
            type="date"
            className="w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Card className="flex-1 min-w-[200px]">
          <CardContent className="py-3 flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">รวมค่าใช้จ่าย {date || "ทั้งหมด"} ({items.length} รายการ)</span>
            <span className="text-xl font-bold text-destructive">฿{fmtMoney(data?.total ?? 0)}</span>
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
              {items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{fmtTime(e.createdAt)}</TableCell>
                  <TableCell className="text-sm font-medium">{e.title}</TableCell>
                  <TableCell className="text-sm">{e.category || "-"}</TableCell>
                  <TableCell className="text-right font-semibold">฿{fmtMoney(e.amount)}</TableCell>
                  <TableCell className="text-sm">{e.staffName || "-"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.note || "-"}</TableCell>
                  {canManage && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="แก้ไข"
                          onClick={() => { setErr(""); setEdit(formFromExpense(e)); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="ลบ"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (confirm(`ยืนยันลบค่าใช้จ่าย "${e.title}" ฿${fmtMoney(e.amount)}?`)) {
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
                  <TableCell colSpan={canManage ? 7 : 6} className="text-center text-muted-foreground py-8">
                    ไม่มีค่าใช้จ่าย{date ? "ของวันนี้" : ""}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog บันทึก/แก้ไขค่าใช้จ่าย */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">{edit?.id ? "แก้ไขค่าใช้จ่าย" : "บันทึกค่าใช้จ่าย"}</DialogTitle>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>รายการ <span className="text-destructive">*</span></Label>
                <Input autoFocus placeholder="เช่น ค่าน้ำแข็ง, ค่าถุง, ค่าแรงชั่วคราว"
                  value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>หมวด</Label>
                  <Input placeholder="เช่น วัตถุดิบ, สาธารณูปโภค"
                    value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>จำนวนเงิน (บาท) <span className="text-destructive">*</span></Label>
                  <Input type="number" min={0} step="0.01" placeholder="0.00"
                    value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>หมายเหตุ</Label>
                <Textarea rows={2} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full" disabled={!valid || create.isPending || update.isPending} onClick={submit}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
