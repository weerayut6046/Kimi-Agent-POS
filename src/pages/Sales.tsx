import { useState } from "react";
import { Eye, Ban, Printer, Receipt, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { TaxInvoiceDialog } from "@/components/TaxInvoiceDialog";
import { ReceiptDoc } from "@/components/ReceiptDoc";
import { printElement } from "@/lib/printDoc";
import { fmtMoney, fmtDateTime, paymentLabel } from "@/lib/format";

export default function Sales() {
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";
  const { data: salesList, isLoading } = trpc.pos.salesHistory.useQuery({ limit: 100 });
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [taxSaleId, setTaxSaleId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const { data: detail } = trpc.pos.saleDetail.useQuery({ id: detailId! }, { enabled: detailId != null });

  const voidMut = trpc.pos.voidSale.useMutation({
    onSuccess: () => {
      utils.pos.salesHistory.invalidate();
      utils.pos.dashboard.invalidate();
      utils.catalog.listProducts.invalidate();
      setDetailId(null);
      setErr("");
    },
    onError: (e) => setErr(e.message),
  });

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
        <Receipt className="w-6 h-6 text-primary" /> ประวัติการขาย
      </h1>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เลขที่บิล</TableHead>
                <TableHead>วันที่</TableHead>
                <TableHead>พนักงาน</TableHead>
                <TableHead>สมาชิก</TableHead>
                <TableHead>ชำระ</TableHead>
                <TableHead className="text-right">ยอดสุทธิ</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(salesList ?? []).map((s) => (
                <TableRow key={s.id} className={s.status === "voided" ? "opacity-50" : ""}>
                  <TableCell className="font-mono text-xs">{s.receiptNo}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(s.createdAt)}</TableCell>
                  <TableCell>{s.staffName || "-"}</TableCell>
                  <TableCell>{s.memberName ?? "-"}</TableCell>
                  <TableCell>{paymentLabel[s.paymentMethod]}</TableCell>
                  <TableCell className="text-right font-semibold">฿{fmtMoney(s.total)}</TableCell>
                  <TableCell>
                    {s.status === "voided" ? <Badge variant="destructive">ยกเลิก</Badge> : <Badge variant="secondary">สำเร็จ</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDetailId(s.id)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (salesList ?? []).length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">ยังไม่มีการขาย</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* รายละเอียดบิล / ใบเสร็จ */}
      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">ใบเสร็จ {detail?.sale.receiptNo}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="text-sm space-y-2">
              <div id="receipt-print">
                <ReceiptDoc
                  sale={{ ...detail.sale, memberName: detail.memberName }}
                  items={detail.items}
                  settingMap={settingMap}
                  staffName={detail.sale.staffName}
                  logoUrl={logoUrl}
                />
              </div>
              <DialogFooter className="gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const el = document.getElementById("receipt-print");
                    if (el) printElement(el, "size: auto; margin: 8mm");
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" /> พิมพ์
                </Button>
                {detail.sale.status === "completed" && (
                  <Button variant="outline" onClick={() => setTaxSaleId(detail.sale.id)}>
                    <FileText className="w-4 h-4 mr-2" /> ใบกำกับภาษีเต็มรูป
                  </Button>
                )}
                {detail.sale.status === "completed" && isAdmin && (
                  <Button
                    variant="destructive"
                    disabled={voidMut.isPending}
                    onClick={() => {
                      if (confirm("ยืนยันยกเลิกบิลนี้? (คืนสต๊อกและแต้มอัตโนมัติ)")) {
                        voidMut.mutate({ id: detail.sale.id });
                      }
                    }}
                  >
                    <Ban className="w-4 h-4 mr-2" /> ยกเลิกบิล
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ใบกำกับภาษีเต็มรูป */}
      <TaxInvoiceDialog saleId={taxSaleId} onClose={() => setTaxSaleId(null)} />
    </div>
  );
}
