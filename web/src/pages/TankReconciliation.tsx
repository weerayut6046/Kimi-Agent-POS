import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Gauge, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { printElement } from "@/lib/printDoc";
import { trpc } from "@/providers/trpc";

type ReconStatus = "ok" | "warn" | "critical";

const statusMeta: Record<ReconStatus, { label: string; className: string }> = {
  ok: {
    label: "ปกติ",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  warn: {
    label: "เฝ้าระวัง",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  critical: {
    label: "ผิดปกติ",
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

function StatusBadge({ status }: { status: ReconStatus | null }) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  const meta = statusMeta[status];
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
}

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const fmtSigned = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

export default function TankReconciliation() {
  const now = new Date();
  const [from, setFrom] = useState(
    toDateInput(new Date(now.getFullYear(), now.getMonth(), 1))
  );
  const [to, setTo] = useState(toDateInput(now));
  const [tankId, setTankId] = useState("all");

  const { data: tanks } = trpc.catalog.listTanks.useQuery();
  const validRange =
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from <= to;
  const recon = trpc.reports.tankReconciliation.useQuery(
    { from, to, tankId: tankId === "all" ? undefined : Number(tankId) },
    { enabled: validRange }
  );

  const printReport = () => {
    const el = document.getElementById("tank-recon-print");
    if (el) printElement(el, "size: auto; margin: 8mm");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-heading flex items-center gap-2">
          <Gauge className="w-6 h-6 text-primary" /> กระทบยอดถัง
        </h1>
        <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
          <Button asChild variant="outline" className="flex-1 sm:flex-none">
            <Link to="/reports">
              <ArrowLeft className="mr-1 size-4" /> รายงานปิดวัน
            </Link>
          </Button>
          <Button
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={printReport}
            disabled={!recon.data}
          >
            <Printer className="mr-1 size-4" /> พิมพ์
          </Button>
          <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <Label
              htmlFor="recon-from"
              className="text-xs text-muted-foreground"
            >
              จากวันที่
            </Label>
            <Input
              id="recon-from"
              type="date"
              className="w-full sm:w-40"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <Label htmlFor="recon-to" className="text-xs text-muted-foreground">
              ถึงวันที่
            </Label>
            <Input
              id="recon-to"
              type="date"
              className="w-full sm:w-40"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
            <Label className="text-xs text-muted-foreground">ถัง</Label>
            <Select value={tankId} onValueChange={setTankId}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="ทุกถัง" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกถัง</SelectItem>
                {(tanks ?? []).map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div id="tank-recon-print" className="space-y-5">
        {recon.isPending && validRange && (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        )}
        {recon.error && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {recon.error.message}
            </CardContent>
          </Card>
        )}
        {recon.data && recon.data.tanks.length === 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              ไม่พบถังในช่วงที่เลือก
            </CardContent>
          </Card>
        )}

        {(recon.data?.tanks ?? []).map(entry => (
          <Card key={entry.tank.id}>
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="font-heading text-lg">
                {entry.tank.name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {entry.tank.productName}
                </span>
              </CardTitle>
              <StatusBadge status={entry.totals.status} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-xs text-muted-foreground">ค่าวัดล่าสุด</p>
                  <p className="font-semibold number-display">
                    {entry.latestReading
                      ? `${fmtNum(entry.latestReading.liters)} ล.`
                      : "-"}
                  </p>
                  {entry.latestReading && (
                    <p className="text-xs text-muted-foreground">
                      {fmtDateTime(entry.latestReading.measuredAt)}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    ส่วนต่างสะสมเทียบยอดคำนวณ
                  </p>
                  <p className="font-semibold number-display">
                    {entry.driftAtLatest != null
                      ? `${fmtSigned(entry.driftAtLatest)} ล.`
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">รับเข้ารวม</p>
                  <p className="font-semibold number-display">
                    {fmtNum(entry.totals.refillsLiters)} ล.
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    จ่ายตามมิเตอร์รวม
                  </p>
                  <p className="font-semibold number-display">
                    {fmtNum(entry.totals.meteredLiters)} ล.
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ผลต่างรวม</p>
                  <p className="font-semibold number-display">
                    {fmtSigned(entry.totals.varianceLiters)} ล.
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">% ของยอดจ่าย</p>
                  <p className="font-semibold number-display">
                    {entry.totals.variancePct != null
                      ? `${fmtSigned(entry.totals.variancePct)}%`
                      : "-"}
                  </p>
                </div>
              </div>

              {entry.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  ยังไม่มีค่าวัดในช่วงนี้ — บันทึกค่าวัดได้ที่หน้าสต๊อกและถัง
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>เวลาที่วัด</TableHead>
                        <TableHead>ผู้วัด</TableHead>
                        <TableHead className="text-right">
                          ค่าวัด (ล.)
                        </TableHead>
                        <TableHead className="text-right">
                          รับเข้าช่วง (ล.)
                        </TableHead>
                        <TableHead className="text-right">
                          มิเตอร์ช่วง (ล.)
                        </TableHead>
                        <TableHead className="text-right">
                          ควรเหลือ (ล.)
                        </TableHead>
                        <TableHead className="text-right">
                          ผลต่าง (ล.)
                        </TableHead>
                        <TableHead className="text-right">%</TableHead>
                        <TableHead>สถานะ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...entry.rows].reverse().map(row => (
                        <TableRow
                          key={row.id}
                          className={row.isBaseline ? "bg-muted/40" : undefined}
                        >
                          <TableCell className="whitespace-nowrap">
                            {fmtDateTime(row.measuredAt)}
                            {row.isBaseline && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                (ตั้งต้น)
                              </span>
                            )}
                            {row.note && (
                              <p className="text-xs text-muted-foreground">
                                {row.note}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>{row.staffName || "-"}</TableCell>
                          <TableCell className="text-right number-display">
                            {fmtNum(row.liters)}
                          </TableCell>
                          <TableCell className="text-right number-display">
                            {row.refillsLiters != null
                              ? fmtNum(row.refillsLiters)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right number-display">
                            {row.meteredLiters != null
                              ? fmtNum(row.meteredLiters)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right number-display">
                            {row.expectedLiters != null
                              ? fmtNum(row.expectedLiters)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right number-display">
                            {row.varianceLiters != null
                              ? fmtSigned(row.varianceLiters)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right number-display">
                            {row.variancePct != null
                              ? fmtSigned(row.variancePct)
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={row.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        <p className="text-xs text-muted-foreground">
          ผลต่าง = ค่าวัด − (ค่าวัดครั้งก่อน + รับเข้า − ลิตรตามมิเตอร์)
          โดยนับเฉพาะกะที่ปิดแล้ว และอ้างอิงการเชื่อมหัวจ่าย→ถังปัจจุบัน ·
          เกณฑ์: |ผลต่าง| ≤ 0.5% ของยอดจ่าย = ปกติ, ≤ 1% = เฝ้าระวัง,
          มากกว่านั้น = ผิดปกติ
        </p>
      </div>
    </div>
  );
}
