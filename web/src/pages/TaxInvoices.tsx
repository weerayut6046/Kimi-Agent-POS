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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { fmtMoney, fmtDateTime } from "@/lib/format";

export default function TaxInvoices() {
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
                          onClick={() => {
                            if (
                              confirm(
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              เลือกบิลที่ต้องการออกใบกำกับภาษี
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="ค้นหาเลขที่บิล"
            value={addQ}
            onChange={e => setAddQ(e.target.value)}
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
