import { useState } from "react";
import { Users, UserPlus, Gift, Star, Search, History, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { fmtDateTime, tierLabel } from "@/lib/format";
import type { Member, Reward } from "@db/schema";

export default function Members() {
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";

  const [search, setSearch] = useState("");
  const { data: memberList } = trpc.membership.listMembers.useQuery({ search: search || undefined });
  const { data: rewardList } = trpc.membership.listRewards.useQuery();
  const { data: redemptions } = trpc.membership.redemptionHistory.useQuery();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [editM, setEditM] = useState<{ id: number; name: string; phone: string; tier: "silver" | "gold" | "platinum" } | null>(null);
  const [adjustPts, setAdjustPts] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [err, setErr] = useState("");

  const { data: txns } = trpc.membership.memberTransactions.useQuery(
    { memberId: selected?.id ?? 0 },
    { enabled: !!selected },
  );

  const refresh = () => {
    utils.membership.listMembers.invalidate();
    utils.membership.listRewards.invalidate();
    utils.membership.redemptionHistory.invalidate();
    utils.membership.memberTransactions.invalidate();
  };

  const createMut = trpc.membership.createMember.useMutation({
    onSuccess: () => { refresh(); setShowCreate(false); setName(""); setPhone(""); setErr(""); },
    onError: (e) => setErr(e.message),
  });
  const adjustMut = trpc.membership.adjustPoints.useMutation({
    onSuccess: () => { refresh(); setAdjustPts(""); setAdjustNote(""); setSelected(null); setErr(""); },
    onError: (e) => setErr(e.message),
  });
  const redeemMut = trpc.membership.redeemReward.useMutation({
    onSuccess: () => { refresh(); setErr(""); },
    onError: (e) => setErr(e.message),
  });
  const updateMut = trpc.membership.updateMember.useMutation({
    onSuccess: () => { refresh(); setEditM(null); setErr(""); },
    onError: (e) => setErr(e.message),
  });
  const deleteMut = trpc.membership.deleteMember.useMutation({
    onSuccess: () => { refresh(); setSelected(null); setErr(""); },
    onError: (e) => setErr(e.message),
  });

  const tierColor: Record<string, string> = {
    silver: "bg-slate-400",
    gold: "bg-amber-500",
    platinum: "bg-indigo-500",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-heading text-2xl font-semibold flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" /> สมาชิกสะสมแต้ม
        </h1>
        <Button onClick={() => setShowCreate(true)}>
          <UserPlus className="w-4 h-4 mr-2" /> สมัครสมาชิก
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="ค้นหา ชื่อ / เบอร์ / รหัสสมาชิก" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* รายชื่อสมาชิก */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รหัส</TableHead>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>เบอร์</TableHead>
                  <TableHead>ระดับ</TableHead>
                  <TableHead className="text-right">แต้ม</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(memberList ?? []).map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.memberCode}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.phone}</TableCell>
                    <TableCell>
                      <Badge className={`${tierColor[m.tier]} text-white hover:${tierColor[m.tier]}`}>{tierLabel[m.tier]}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-primary">{m.points}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setSelected(m)}>จัดการ</Button>
                        {isAdmin && (
                          <>
                            <Button size="icon" variant="ghost" className="h-8 w-8"
                              onClick={() => setEditM({ id: m.id, name: m.name, phone: m.phone, tier: m.tier })}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                              disabled={deleteMut.isPending}
                              onClick={() => {
                                if (confirm(`ยืนยันลบสมาชิก "${m.name}"?`)) deleteMut.mutate({ id: m.id });
                              }}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(memberList ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">ไม่พบสมาชิก</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ของรางวัล */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Gift className="w-4 h-4 text-primary" /> ของรางวัลแลกแต้ม
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(rewardList ?? []).map((r: Reward) => (
              <div key={r.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.pointsRequired} แต้ม · คงเหลือ {r.stock}</div>
                </div>
                <Badge variant="secondary"><Star className="w-3 h-3 mr-1" />{r.pointsRequired}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ประวัติแลกรางวัล */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <History className="w-4 h-4" /> ประวัติแลกของรางวัล
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead>สมาชิก</TableHead>
                <TableHead>ของรางวัล</TableHead>
                <TableHead className="text-right">แต้มที่ใช้</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(redemptions ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell>{r.memberName}</TableCell>
                  <TableCell>{r.rewardName}</TableCell>
                  <TableCell className="text-right text-destructive font-semibold">-{r.pointsUsed}</TableCell>
                </TableRow>
              ))}
              {(redemptions ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">ยังไม่มีประวัติ</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog สมัครสมาชิก */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">สมัครสมาชิกใหม่</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>ชื่อ-นามสกุล</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมชาย ใจดี" />
            </div>
            <div className="space-y-1.5">
              <Label>เบอร์โทรศัพท์</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="08x-xxx-xxxx" />
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full" disabled={!name || phone.length < 9 || createMut.isPending}
              onClick={() => createMut.mutate({ name, phone })}>
              สมัครสมาชิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขสมาชิก (admin) */}
      <Dialog open={!!editM} onOpenChange={(o) => !o && setEditM(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="font-heading">แก้ไขสมาชิก</DialogTitle></DialogHeader>
          {editM && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>ชื่อ-นามสกุล</Label>
                <Input value={editM.name} onChange={(e) => setEditM({ ...editM, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>เบอร์โทรศัพท์</Label>
                <Input value={editM.phone} onChange={(e) => setEditM({ ...editM, phone: e.target.value })} inputMode="tel" />
              </div>
              <div className="space-y-1.5">
                <Label>ระดับสมาชิก</Label>
                <Select value={editM.tier} onValueChange={(v) => setEditM({ ...editM, tier: v as typeof editM.tier })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="silver">ซิลเวอร์</SelectItem>
                    <SelectItem value="gold">โกลด์</SelectItem>
                    <SelectItem value="platinum">แพลทินัม</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full" disabled={!editM?.name || updateMut.isPending}
              onClick={() => editM && updateMut.mutate(editM)}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog จัดการสมาชิก */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {selected?.name} <span className="text-sm font-normal text-muted-foreground">({selected?.memberCode})</span>
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 bg-blue-50 rounded-xl p-3">
                <div>
                  <div className="text-xs text-muted-foreground">แต้มคงเหลือ</div>
                  <div className="font-heading text-2xl font-bold text-primary">{selected.points}</div>
                </div>
                <Badge className={`${tierColor[selected.tier]} text-white ml-auto`}>{tierLabel[selected.tier]}</Badge>
              </div>

              {/* แลกของรางวัล */}
              <div>
                <div className="text-sm font-medium mb-2">แลกของรางวัล</div>
                <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto">
                  {(rewardList ?? []).filter((r) => r.active && r.stock > 0).map((r) => (
                    <div key={r.id} className="flex items-center justify-between border rounded-lg px-3 py-1.5 text-sm">
                      <span>{r.name} <span className="text-xs text-muted-foreground">({r.pointsRequired} แต้ม)</span></span>
                      <Button
                        size="sm" variant={selected.points >= r.pointsRequired ? "default" : "outline"}
                        disabled={selected.points < r.pointsRequired || redeemMut.isPending}
                        onClick={() => redeemMut.mutate({ memberId: selected.id, rewardId: r.id })}
                      >แลก</Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* ปรับแต้ม (admin) */}
              {isAdmin && (
                <div className="border rounded-xl p-3 space-y-2">
                  <div className="text-sm font-medium">ปรับแต้ม (แอดมิน)</div>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="+/-" value={adjustPts} onChange={(e) => setAdjustPts(e.target.value)} className="w-24" />
                    <Input placeholder="เหตุผล" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
                  </div>
                  <Button size="sm" variant="secondary" disabled={!adjustPts || !adjustNote || adjustMut.isPending}
                    onClick={() => adjustMut.mutate({ memberId: selected.id, points: Number(adjustPts), note: adjustNote })}>
                    บันทึกปรับแต้ม
                  </Button>
                </div>
              )}

              {/* ประวัติแต้ม */}
              <div>
                <div className="text-sm font-medium mb-2">ประวัติแต้มล่าสุด</div>
                <div className="divide-y text-sm max-h-40 overflow-y-auto">
                  {(txns ?? []).map((t) => (
                    <div key={t.id} className="py-1.5 flex justify-between gap-2">
                      <div>
                        <div className="text-xs text-muted-foreground">{fmtDateTime(t.createdAt)}</div>
                        <div>{t.note}</div>
                      </div>
                      <span className={`font-semibold ${t.points >= 0 ? "text-green-600" : "text-destructive"}`}>
                        {t.points >= 0 ? "+" : ""}{t.points}
                      </span>
                    </div>
                  ))}
                  {(txns ?? []).length === 0 && <p className="text-xs text-muted-foreground py-3 text-center">ยังไม่มีประวัติ</p>}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
