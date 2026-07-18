import { useMemo, useState } from "react";
import { Clock, PlayCircle, StopCircle, Eye, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { fmtMoney, fmtNum, fmtDateTime } from "@/lib/format";

const r2 = (n: number) => Math.round(n * 100) / 100;
const DIFF_TOLERANCE = 1; // บาท

function DiffBadge({ diff }: { diff: number | null }) {
  if (diff == null) return null;
  const ok = Math.abs(diff) <= DIFF_TOLERANCE;
  if (ok) {
    return (
      <Badge className="bg-green-600 hover:bg-green-600 gap-1">
        <CheckCircle2 className="w-3 h-3" /> ตรงกัน
      </Badge>
    );
  }
  // บวก = เงินเกิน (เขียว) / ลบ = เงินขาด (แดง)
  if (diff > 0) {
    return (
      <Badge className="bg-green-600 hover:bg-green-600 gap-1">
        <AlertTriangle className="w-3 h-3" /> ต่าง +{fmtMoney(diff)}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="w-3 h-3" /> ต่าง {fmtMoney(diff)}
    </Badge>
  );
}

export default function Shifts() {
  const { staff } = useStaff();
  const utils = trpc.useUtils();
  const { data: currentShift, isLoading } = trpc.pos.currentShift.useQuery();
  const { data: pumps } = trpc.catalog.listPumps.useQuery();
  const { data: history } = trpc.pos.shiftHistory.useQuery();

  const [openVals, setOpenVals] = useState<Record<number, { l?: string; p?: string }>>({});
  const [closeVals, setCloseVals] = useState<Record<number, { l?: string; p?: string }>>({});
  const [detailId, setDetailId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const { data: detail } = trpc.pos.shiftDetail.useQuery(
    { id: detailId! },
    { enabled: detailId != null },
  );

  const invalidate = () => {
    utils.pos.currentShift.invalidate();
    utils.pos.shiftHistory.invalidate();
    utils.pos.dashboard.invalidate();
    utils.catalog.listPumps.invalidate();
    utils.catalog.listTanks.invalidate();
  };

  const openShift = trpc.pos.openShift.useMutation({
    onSuccess: () => { invalidate(); setErr(""); setOpenVals({}); },
    onError: (e) => setErr(e.message),
  });
  const closeShift = trpc.pos.closeShift.useMutation({
    onSuccess: () => { invalidate(); setCloseVals({}); setErr(""); },
    onError: (e) => setErr(e.message),
  });

  const nozzleList = useMemo(
    () => (pumps ?? []).flatMap((p) => p.nozzles.filter((n) => n.active).map((n) => ({ ...n, pumpName: p.name }))),
    [pumps],
  );

  // พรีวิวยอดปิดกะ
  const closePreview = useMemo(() => {
    if (!currentShift) return null;
    let liters = 0, amountL = 0, money = 0;
    let filled = true;
    for (const r of currentShift.readings) {
      const cl = Number(closeVals[r.nozzleId]?.l);
      const cp = Number(closeVals[r.nozzleId]?.p);
      if (!closeVals[r.nozzleId]?.l || !closeVals[r.nozzleId]?.p) filled = false;
      if (cl && cl >= r.openMeter) {
        liters += cl - r.openMeter;
        amountL += (cl - r.openMeter) * r.pricePerLiter;
      }
      if (cp && cp >= r.openMoney) money += cp - r.openMoney;
    }
    return {
      liters: r2(liters),
      amountL: r2(amountL),
      money: r2(money),
      diff: r2(money - amountL),
      filled,
    };
  }, [closeVals, currentShift]);

  if (isLoading) return <div className="py-20 text-center text-muted-foreground">กำลังโหลด...</div>;

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold">ตัดกะ</h1>

      {err && (
        <Card className="border-destructive bg-red-50">
          <CardContent className="py-3 px-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {err}
          </CardContent>
        </Card>
      )}

      {/* ============ เปิดกะ ============ */}
      {!currentShift && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading flex items-center gap-2">
              <PlayCircle className="w-5 h-5 text-green-600" /> เปิดกะใหม่ — บันทึกมิเตอร์ตั้งต้น (L และ P)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              พนักงาน: <b>{staff?.name}</b> · ระบบดึงเลขมิเตอร์ล่าสุดมาให้แล้ว ตรวจสอบหน้าตู้จ่ายอีกครั้งก่อนกดเปิดกะ
              (<b>L</b> = ลิตรสะสม, <b>P</b> = ยอดเงินสะสม บาท)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {nozzleList.map((n) => (
                <div key={n.id} className="border rounded-xl p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm">{n.label}</span>
                    <Badge variant="secondary">{n.product?.name}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">P ตั้งต้น (บาท)</span>
                    <Input
                      type="number" step="0.01"
                      value={openVals[n.id]?.p ?? String(n.currentMoney)}
                      onChange={(e) => setOpenVals((m) => ({ ...m, [n.id]: { ...m[n.id], p: e.target.value } }))}
                      className="h-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-24">L ตั้งต้น (ลิตร)</span>
                    <Input
                      type="number" step="0.01"
                      value={openVals[n.id]?.l ?? String(n.currentMeter)}
                      onChange={(e) => setOpenVals((m) => ({ ...m, [n.id]: { ...m[n.id], l: e.target.value } }))}
                      className="h-9"
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button
              className="w-full sm:w-auto h-11"
              disabled={openShift.isPending || nozzleList.length === 0}
              onClick={() =>
                openShift.mutate({
                  staffId: staff?.id,
                  staffName: staff?.name ?? "",
                  readings: nozzleList.map((n) => ({
                    nozzleId: n.id,
                    openMeter: Number(openVals[n.id]?.l ?? n.currentMeter),
                    openMoney: Number(openVals[n.id]?.p ?? n.currentMoney),
                  })),
                })
              }
            >
              <PlayCircle className="w-5 h-5 mr-2" /> เปิดกะ
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ============ ปิดกะ ============ */}
      {currentShift && (
        <Card className="border-green-300">
          <CardHeader>
            <CardTitle className="font-heading flex items-center gap-2 flex-wrap">
              <StopCircle className="w-5 h-5 text-destructive" /> ปิดกะ — บันทึกมิเตอร์ปลายทาง (L และ P)
              <Badge className="bg-green-600 hover:bg-green-600">
                <Clock className="w-3 h-3 mr-1" /> เปิดโดย {currentShift.staffName} เมื่อ {fmtDateTime(currentShift.openedAt)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {currentShift.readings.map((r) => {
                const cl = Number(closeVals[r.nozzleId]?.l);
                const cp = Number(closeVals[r.nozzleId]?.p);
                const liters = cl && cl >= r.openMeter ? r2(cl - r.openMeter) : null;
                const money = cp && cp >= r.openMoney ? r2(cp - r.openMoney) : null;
                const amountL = liters != null ? r2(liters * r.pricePerLiter) : null;
                const diff = money != null && amountL != null ? r2(money - amountL) : null;
                return (
                  <div key={r.nozzleId} className="border rounded-xl p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-sm">{r.nozzle?.label}</span>
                      <Badge variant="secondary">฿{fmtMoney(r.pricePerLiter)}/ล.</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {r.openMoney > 0 ? (
                        <span>P ตั้งต้น: <b className="text-foreground">฿{fmtNum(r.openMoney)}</b></span>
                      ) : (
                        <span className="text-amber-600">P ตั้งต้น: ไม่มี (กะเก่า)</span>
                      )}
                      <span>L ตั้งต้น: <b className="text-foreground">{fmtNum(r.openMeter)}</b></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24">P ปิดกะ (บาท)</span>
                      <Input
                        type="number" step="0.01"
                        placeholder="เลขเงินปลายทาง"
                        value={closeVals[r.nozzleId]?.p ?? ""}
                        onChange={(e) => setCloseVals((m) => ({ ...m, [r.nozzleId]: { ...m[r.nozzleId], p: e.target.value } }))}
                        className="h-9"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24">L ปิดกะ (ลิตร)</span>
                      <Input
                        type="number" step="0.01"
                        placeholder="เลขลิตรปลายทาง"
                        value={closeVals[r.nozzleId]?.l ?? ""}
                        onChange={(e) => setCloseVals((m) => ({ ...m, [r.nozzleId]: { ...m[r.nozzleId], l: e.target.value } }))}
                        className="h-9"
                      />
                    </div>
                    {liters != null && (
                      <div className="text-xs bg-blue-50 rounded-lg px-2 py-1.5 flex flex-wrap justify-between gap-1">
                        <span>ขาย <b>{fmtNum(liters)} ล.</b></span>
                        <span>จากลิตร: <b>฿{fmtMoney(amountL ?? 0)}</b></span>
                        {money != null && <span>จาก P: <b>฿{fmtMoney(money)}</b></span>}
                        <DiffBadge diff={diff} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {closePreview && closePreview.filled && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                <div>
                  <div className="text-xs text-muted-foreground">รวมลิตรที่ขาย</div>
                  <div className="font-heading text-xl font-semibold">{fmtNum(closePreview.liters)} ลิตร</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ยอดจากลิตร × ราคา</div>
                  <div className="font-heading text-xl font-semibold text-primary">฿{fmtMoney(closePreview.amountL)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ยอดจากมิเตอร์เงิน (P)</div>
                  <div className="font-heading text-xl font-semibold text-indigo-600">฿{fmtMoney(closePreview.money)}</div>
                </div>
                <div className="ml-auto">
                  <DiffBadge diff={closePreview.diff} />
                </div>
              </div>
            )}

            <Button
              variant="destructive"
              className="w-full sm:w-auto h-11"
              disabled={closeShift.isPending || !closePreview?.filled}
              onClick={() =>
                closeShift.mutate({
                  shiftId: currentShift.id,
                  readings: currentShift.readings.map((r) => ({
                    nozzleId: r.nozzleId,
                    closeMeter: Number(closeVals[r.nozzleId]?.l),
                    closeMoney: Number(closeVals[r.nozzleId]?.p),
                  })),
                })
              }
            >
              <StopCircle className="w-5 h-5 mr-2" /> ยืนยันปิดกะ (หักถังอัตโนมัติ)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ============ ประวัติ ============ */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">ประวัติการตัดกะ</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เปิดกะ</TableHead>
                <TableHead>พนักงาน</TableHead>
                <TableHead className="text-right">ยอดจาก P</TableHead>
                <TableHead className="text-right">ยอดจากลิตร</TableHead>
                <TableHead className="text-right">ลิตร</TableHead>
                <TableHead>เทียบ</TableHead>
                <TableHead className="text-right">ยอด POS</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(s.openedAt)}</TableCell>
                  <TableCell>{s.staffName}</TableCell>
                  <TableCell className="text-right">฿{fmtMoney(s.totalMoneyMeter)}</TableCell>
                  <TableCell className="text-right">฿{fmtMoney(s.totalAmount)}</TableCell>
                  <TableCell className="text-right">{fmtNum(s.totalLiters)}</TableCell>
                  <TableCell>
                    {s.status === "closed" && s.totalMoneyMeter > 0 && (
                      <DiffBadge diff={r2(s.totalMoneyMeter - s.totalAmount)} />
                    )}
                  </TableCell>
                  <TableCell className="text-right">฿{fmtMoney(s.posAmount)}</TableCell>
                  <TableCell>
                    {s.status === "open" ? (
                      <Badge className="bg-green-600 hover:bg-green-600">เปิดอยู่</Badge>
                    ) : (
                      <Badge variant="secondary">ปิดแล้ว</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDetailId(s.id)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(history ?? []).length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">ยังไม่มีประวัติ</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* รายละเอียดกะ */}
      <Dialog open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="font-heading">รายละเอียดกะ #{detailId}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm min-w-0">
              <div className="grid grid-cols-2 gap-2">
                <div>พนักงาน: <b>{detail.staffName}</b></div>
                <div>เปิด: {fmtDateTime(detail.openedAt)}</div>
                <div>ปิด: {detail.closedAt ? fmtDateTime(detail.closedAt) : "-"}</div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>หัวจ่าย</TableHead>
                      <TableHead className="text-right">L ตั้งต้น → ปิด</TableHead>
                      <TableHead className="text-right">ลิตร</TableHead>
                      <TableHead className="text-right">P ตั้งต้น → ปิด</TableHead>
                      <TableHead className="text-right">ยอดจากลิตร</TableHead>
                      <TableHead className="text-right">ยอดจาก P</TableHead>
                      <TableHead>เทียบ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.readings.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{r.nozzle?.label}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">
                          {fmtNum(r.openMeter)} → {r.closeMeter != null ? fmtNum(r.closeMeter) : "-"}
                        </TableCell>
                        <TableCell className="text-right">{r.liters != null ? fmtNum(r.liters) : "-"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs">
                          {fmtNum(r.openMoney)} → {r.closeMoney != null ? fmtNum(r.closeMoney) : "-"}
                        </TableCell>
                        <TableCell className="text-right">{r.amount != null ? `฿${fmtMoney(r.amount)}` : "-"}</TableCell>
                        <TableCell className="text-right">{r.money != null ? `฿${fmtMoney(r.money)}` : "-"}</TableCell>
                        <TableCell><DiffBadge diff={r.diff} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center gap-4 bg-blue-50 rounded-xl p-3">
                <div>ยอดจาก P: <b>฿{fmtMoney(detail.totalMoneyMeter)}</b></div>
                <div>ยอดจากลิตร: <b>฿{fmtMoney(detail.totalAmount)}</b></div>
                <div>รวมลิตร: <b>{fmtNum(detail.totalLiters)}</b></div>
                <div>ยอด POS: <b>฿{fmtMoney(detail.posAmount)}</b></div>
                {detail.status === "closed" && (
                  <DiffBadge diff={r2(detail.totalMoneyMeter - detail.totalAmount)} />
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
