import { useEffect, useState } from "react";
import { Eye, FileText, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { useAppConfirm } from "@/components/AppConfirmDialog";
import { fmtMoney, fmtDateTime } from "@/lib/format";

export default function TaxInvoices() {
  const confirmAction = useAppConfirm();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const utils = trpc.useUtils();

  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [err, setErr] = useState("");

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: rows, isLoading } = trpc.taxInvoice.list.useQuery({
    q: search || undefined,
  });
  const { data: available } = trpc.taxInvoice.salesAvailable.useQuery(
    undefined,
    { enabled: showAdd }
  );

  const remove = trpc.taxInvoice.remove.useMutation({
    onSuccess: () => utils.taxInvoice.list.invalidate(),
    onError: e => setErr(e.message),
  });

  const availableFiltered = (available ?? []).filter(
    s => !addQ || s.receiptNo.toLowerCase().includes(addQ.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-heading flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" />{" "}
          ใบเสร็จรับเงิน/ใบกำกับภาษี
        </h1>
        {isAdmin && (
          <Button className="w-full sm:w-auto" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1" /> ออกใบกำกับภาษี
          </Button>
        )}
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="ค้นหา เลขที่ / ลูกค้า / เลขผู้เสียภาษี / ใบเสร็จย่อ"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่ใบกำกับภาษี</TableHead>
                <TableHead>วันที่ออก</TableHead>
                <TableHead>ใบเสร็จย่อ</TableHead>
                <TableHead>ลูกค้า</TableHead>
                <TableHead className="text-right">ยอดเงิน</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {r.taxInvoiceNo}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fmtDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.receiptNo}
                    {r.saleStatus === "voided" && (
                      <Badge variant="destructive" className="ml-1.5">
                        บิลยกเลิก
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{r.customerName}</div>
                    {r.customerTaxId && (
                      <div className="text-xs text-muted-foreground">
                        {r.customerTaxId}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    ฿{fmtMoney(r.saleTotal)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="ดู/พิมพ์"
                        onClick={() => setTaxSaleId(r.saleId)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          title="ลบ"
                          disabled={remove.isPending}
                          onClick={async () => {
                            if (
                              await confirmAction(
                                `ยืนยันลบใบกำกับภาษี ${r.taxInvoiceNo}?\n(บิลขาย ${r.receiptNo} ยังคงอยู่ สามารถออกใบกำกับใหม่ได้)`
                              )
                            ) {
                              remove.mutate({ id: r.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    {search
                      ? "ไม่พบใบกำกับภาษีที่ค้นหา"
                      : "ยังไม่มีใบกำกับภาษี"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* เลือกบิลเพื่อออกใบกำกับภาษี (admin) */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <FileText className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    New tax invoice
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  เลือกบิลที่ต้องการออกใบกำกับภาษี
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  ค้นหาและเลือกใบเสร็จย่อที่ยังไม่ได้ออกใบกำกับภาษี
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Search className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    เลือกใบเสร็จย่อ
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    บิลขายที่ยังไม่มีใบกำกับภาษี
                  </p>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <Input
                  autoFocus
                  placeholder="ค้นหาเลขที่บิล"
                  value={addQ}
                  onChange={e => setAddQ(e.target.value)}
                  className="bg-white"
                />
                <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
                  {availableFiltered.map(s => (
                    <button
                      key={s.id}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex justify-between gap-2 text-sm"
                      onClick={() => {
                        setShowAdd(false);
                        setAddQ("");
                        setTaxSaleId(s.id);
                      }}
                    >
                      <span className="font-mono text-xs">{s.receiptNo}</span>
                      <span className="text-muted-foreground text-xs">
                        {fmtDateTime(s.createdAt)}
                      </span>
                      <span className="font-semibold">฿{fmtMoney(s.total)}</span>
                    </button>
                  ))}
                  {availableFiltered.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      ไม่มีบิลที่รอออกใบกำกับภาษี
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {/* ดู/แก้ไข/พิมพ์ใบกำกับภาษี */}
      <TaxInvoiceDialog
        saleId={taxSaleId}
        onClose={() => setTaxSaleId(null)}
        canEdit={isAdmin}
      />
    </div>
  );
}
