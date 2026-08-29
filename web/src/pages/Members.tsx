import { useRef, useState } from "react";
import {
  Users,
  UserPlus,
  Gift,
  Star,
  Search,
  History,
  Pencil,
  Trash2,
  CreditCard,
  ScanLine,
  QrCode,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { useAppConfirm } from "@/components/AppConfirmDialog";
import { MemberCardDialog } from "@/components/MemberCardDialog";
import { CustomerLoyaltyQrDialog } from "@/components/CustomerLoyaltyQrDialog";
import { fmtDateTH, fmtDateTime, tierLabel } from "@/lib/format";
import {
  extractMemberCardCode,
  formatMemberCode,
  isLongMemberCode,
} from "@contracts/memberCode";
import { isMemberCardExpired } from "@contracts/memberExpiry";
import type { Member, Reward } from "@db/schema";
import { toast } from "sonner";

export default function Members() {
  const confirmAction = useAppConfirm();
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const isAdmin = staff?.role === "admin";

  const [search, setSearch] = useState("");
  const { data: memberList } = trpc.membership.listMembers.useQuery({
    search: search || undefined,
  });
  const { data: rewardList } = trpc.membership.listRewards.useQuery();
  const { data: redemptions } = trpc.membership.redemptionHistory.useQuery();
  const { data: settingMap } = trpc.catalog.getSettings.useQuery();
  const { data: logoUrl } = trpc.catalog.getShopLogo.useQuery();

  const [showCreate, setShowCreate] = useState(false);
  const [showCustomerQr, setShowCustomerQr] = useState(false);
  const [cardInput, setCardInput] = useState("");
  const [autoGenerateCode, setAutoGenerateCode] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const cardInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [cardMember, setCardMember] = useState<Member | null>(null);
  const [editM, setEditM] = useState<{
    id: number;
    name: string;
    phone: string;
    tier: "silver" | "gold" | "platinum";
  } | null>(null);
  const [adjustPts, setAdjustPts] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [err, setErr] = useState("");

  const detectedCardCode = extractMemberCardCode(cardInput);
  const cardCodeValid = isLongMemberCode(detectedCardCode);
  const cardAvailability = trpc.membership.checkCardAvailability.useQuery(
    { cardCode: detectedCardCode || "-" },
    {
      enabled: showCreate && !autoGenerateCode && cardCodeValid,
      staleTime: 0,
    }
  );
  const cardReady =
    autoGenerateCode ||
    (cardCodeValid && cardAvailability.data?.available === true);
  const selectedExpired = selected
    ? isMemberCardExpired(selected.cardExpiresAt)
    : false;

  const { data: txns } = trpc.membership.memberTransactions.useQuery(
    { memberId: selected?.id ?? 0 },
    { enabled: !!selected }
  );

  const refresh = () => {
    utils.membership.listMembers.invalidate();
    utils.membership.listRewards.invalidate();
    utils.membership.redemptionHistory.invalidate();
    utils.membership.memberTransactions.invalidate();
  };

  const createMut = trpc.membership.createMember.useMutation({
    onSuccess: result => {
      refresh();
      toast.success(
        `เปิดสมาชิกสำเร็จ · ${formatMemberCode(result.memberCode)}`
      );
      setShowCreate(false);
      setCardInput("");
      setAutoGenerateCode(false);
      setName("");
      setPhone("");
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const submitNewMember = () => {
    if (!name.trim() || phone.trim().length < 9 || createMut.isPending) return;
    if (!autoGenerateCode && !cardCodeValid) {
      setErr("กรุณาเสียบ สแกน หรือกรอกเลขบัตร 16 หลักให้ถูกต้อง");
      cardInputRef.current?.focus();
      return;
    }
    if (!autoGenerateCode && cardAvailability.data?.available === false) {
      setErr("บัตรนี้เปิดใช้งานแล้ว");
      return;
    }
    createMut.mutate({
      name: name.trim(),
      phone: phone.trim(),
      cardCode: autoGenerateCode ? undefined : detectedCardCode,
    });
  };

  const setCreateDialogOpen = (open: boolean) => {
    setShowCreate(open);
    setErr("");
    if (!open) {
      setCardInput("");
      setAutoGenerateCode(false);
      setName("");
      setPhone("");
    }
  };
  const adjustMut = trpc.membership.adjustPoints.useMutation({
    onSuccess: () => {
      refresh();
      setAdjustPts("");
      setAdjustNote("");
      setSelected(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });
  const redeemMut = trpc.membership.redeemReward.useMutation({
    onSuccess: () => {
      refresh();
      setErr("");
    },
    onError: e => setErr(e.message),
  });
  const updateMut = trpc.membership.updateMember.useMutation({
    onSuccess: () => {
      refresh();
      setEditM(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });
  const deleteMut = trpc.membership.deleteMember.useMutation({
    onSuccess: () => {
      refresh();
      setSelected(null);
      setErr("");
    },
    onError: e => setErr(e.message),
  });

  const tierColor: Record<string, string> = {
    silver: "bg-slate-400",
    gold: "bg-amber-500",
    platinum: "bg-indigo-500",
  };
  const configuredCustomerUrl =
    import.meta.env.VITE_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ?? "";
  const customerLoyaltyUrl = `${configuredCustomerUrl || window.location.origin}/loyalty`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="page-heading flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" /> สมาชิกสะสมแต้ม
        </h1>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Badge
            variant="outline"
            className="h-9 border-violet-200 bg-violet-50 px-3 text-violet-700"
          >
            สมาชิกและแต้มใช้ร่วมกันทุกสาขา
          </Badge>
          <Button
            variant="outline"
            className="flex-1 border-violet-200 bg-white text-violet-700 hover:bg-violet-50 sm:flex-none"
            onClick={() => setShowCustomerQr(true)}
          >
            <QrCode className="mr-2 size-4" /> QR เช็กแต้ม
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            onClick={() => setCreateDialogOpen(true)}
          >
            <UserPlus className="w-4 h-4 mr-2" /> สมัครสมาชิก
          </Button>
        </div>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="ค้นหา ชื่อ / เบอร์ / รหัสสมาชิก"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
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
                {(memberList ?? []).map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">
                      <div className="font-mono">
                        {formatMemberCode(m.memberCode)}
                      </div>
                      <div
                        className={`mt-1 font-sans ${
                          isMemberCardExpired(m.cardExpiresAt)
                            ? "font-semibold text-red-600"
                            : "text-muted-foreground"
                        }`}
                      >
                        {isMemberCardExpired(m.cardExpiresAt)
                          ? "หมดอายุ"
                          : "ใช้ได้ถึง"}{" "}
                        {fmtDateTH(m.cardExpiresAt)}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.phone}</TableCell>
                    <TableCell>
                      <Badge
                        className={`${tierColor[m.tier]} text-white hover:${tierColor[m.tier]}`}
                      >
                        {tierLabel[m.tier]}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        isMemberCardExpired(m.cardExpiresAt)
                          ? "text-slate-400"
                          : "text-primary"
                      }`}
                    >
                      {m.points}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setCardMember(m)}
                          title="ดูและพิมพ์บัตรสมาชิก PVC"
                        >
                          <CreditCard className="mr-1.5 size-4" /> บัตร
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(m)}
                        >
                          จัดการ
                        </Button>
                        {isAdmin && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() =>
                                setEditM({
                                  id: m.id,
                                  name: m.name,
                                  phone: m.phone,
                                  tier: m.tier,
                                })
                              }
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              disabled={deleteMut.isPending}
                              onClick={async () => {
                                if (
                                  await confirmAction(
                                    `ยืนยันลบสมาชิก "${m.name}"?`
                                  )
                                )
                                  deleteMut.mutate({ id: m.id });
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(memberList ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-8"
                    >
                      ไม่พบสมาชิก
                    </TableCell>
                  </TableRow>
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
              <div
                key={r.id}
                className="flex items-center justify-between border rounded-lg px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.pointsRequired} แต้ม · คงเหลือ {r.stock}
                  </div>
                </div>
                <Badge variant="secondary">
                  <Star className="w-3 h-3 mr-1" />
                  {r.pointsRequired}
                </Badge>
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
              {(redemptions ?? []).map(r => (
                <TableRow key={r.id}>
                  <TableCell>{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell>{r.memberName}</TableCell>
                  <TableCell>{r.rewardName}</TableCell>
                  <TableCell className="text-right text-destructive font-semibold">
                    -{r.pointsUsed}
                  </TableCell>
                </TableRow>
              ))}
              {(redemptions ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-6"
                  >
                    ยังไม่มีประวัติ
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog สมัครสมาชิก */}
      <Dialog open={showCreate} onOpenChange={setCreateDialogOpen}>
        <DialogContent
          className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-lg sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100"
          onOpenAutoFocus={event => {
            event.preventDefault();
            cardInputRef.current?.focus();
          }}
        >
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <UserPlus className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    New member
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  สมัครสมาชิกใหม่
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  เสียบหรือสแกนบัตรใหม่ แล้วกรอกข้อมูลเพื่อเปิดใช้งานทันที
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
            {err && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {err}
              </div>
            )}
            <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm shadow-violet-100/60">
              <div className="flex items-center gap-3 border-b border-violet-100 bg-violet-50/80 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-violet-600 text-white">
                  <ScanLine className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    เปิดใช้งานบัตรใหม่
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    รองรับเครื่องอ่าน USB/HID, QR และบาร์โค้ด
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-violet-700"
                  onClick={() => {
                    setAutoGenerateCode(value => !value);
                    setErr("");
                  }}
                >
                  {autoGenerateCode ? "ใช้บัตรจริง" : "ไม่มีบัตร"}
                </Button>
              </div>
              <div className="space-y-2 p-4">
                <Label className="text-xs font-semibold text-slate-700">
                  เลขบัตรสมาชิก 16 หลัก
                </Label>
                <div className="relative">
                  <CreditCard className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-violet-500" />
                  <Input
                    ref={cardInputRef}
                    value={
                      autoGenerateCode
                        ? "ระบบจะสร้างเลขบัตรให้อัตโนมัติ"
                        : cardInput
                    }
                    disabled={autoGenerateCode}
                    autoComplete="off"
                    placeholder="เสียบบัตร สแกน หรือกรอกเลขบัตร"
                    aria-label="เลขบัตรสมาชิกใหม่"
                    className="h-12 bg-white pl-10 font-mono tracking-wider"
                    onChange={event => {
                      setCardInput(event.target.value);
                      setErr("");
                    }}
                    onBlur={() => {
                      if (cardCodeValid) {
                        setCardInput(formatMemberCode(detectedCardCode));
                      }
                    }}
                    onKeyDown={event => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      if (cardCodeValid) {
                        setCardInput(formatMemberCode(detectedCardCode));
                        if (name.trim() && phone.trim().length >= 9) {
                          submitNewMember();
                        } else {
                          nameInputRef.current?.focus();
                        }
                      } else {
                        setErr("อ่านเลขบัตรไม่สำเร็จ กรุณาลองอีกครั้ง");
                      }
                    }}
                  />
                </div>
                {!autoGenerateCode && !cardInput && (
                  <p className="text-xs text-slate-500">
                    วางเคอร์เซอร์ช่องนี้แล้วเสียบ/รูดบัตร
                    เครื่องอ่านจะส่งเลขเข้าระบบ
                  </p>
                )}
                {!autoGenerateCode && cardInput && !cardCodeValid && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700">
                    <CircleAlert className="size-3.5" />
                    เลขยังไม่ครบหรือ check digit ไม่ถูกต้อง
                  </p>
                )}
                {!autoGenerateCode &&
                  cardCodeValid &&
                  cardAvailability.isFetching && (
                    <p className="text-xs text-violet-600">กำลังตรวจสอบบัตร…</p>
                  )}
                {!autoGenerateCode &&
                  cardAvailability.data?.available === true && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <CircleCheck className="size-3.5" />
                      บัตรใหม่ พร้อมเปิดใช้งาน
                    </p>
                  )}
                {!autoGenerateCode &&
                  cardAvailability.data?.available === false &&
                  cardCodeValid && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-red-700">
                      <CircleAlert className="size-3.5" />
                      บัตรนี้เปิดใช้งานแล้ว
                    </p>
                  )}
              </div>
            </section>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    ข้อมูลสมาชิก
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ชื่อและเบอร์โทรศัพท์สำหรับติดต่อ
                  </p>
                </div>
              </div>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    ชื่อ-นามสกุล
                  </Label>
                  <Input
                    ref={nameInputRef}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="เช่น สมชาย ใจดี"
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    เบอร์โทรศัพท์
                  </Label>
                  <Input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="08x-xxx-xxxx"
                    className="bg-white"
                    onKeyDown={event => {
                      if (event.key === "Enter" && cardReady) {
                        event.preventDefault();
                        submitNewMember();
                      }
                    }}
                  />
                </div>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={
                !name.trim() ||
                phone.trim().length < 9 ||
                !cardReady ||
                createMut.isPending
              }
              onClick={submitNewMember}
            >
              {autoGenerateCode
                ? "สมัครสมาชิกและสร้างเลขอัตโนมัติ"
                : "เปิดใช้งานบัตรและเพิ่มสมาชิก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog แก้ไขสมาชิก (admin) */}
      <Dialog open={!!editM} onOpenChange={o => !o && setEditM(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Pencil className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Edit member
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  แก้ไขสมาชิก
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  ปรับปรุงข้อมูลติดต่อและระดับสมาชิก
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {editM && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ข้อมูลสมาชิก
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      ชื่อ เบอร์โทรศัพท์ และระดับสมาชิก
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ชื่อ-นามสกุล
                    </Label>
                    <Input
                      value={editM.name}
                      onChange={e =>
                        setEditM({ ...editM, name: e.target.value })
                      }
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      เบอร์โทรศัพท์
                    </Label>
                    <Input
                      value={editM.phone}
                      onChange={e =>
                        setEditM({ ...editM, phone: e.target.value })
                      }
                      inputMode="tel"
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      ระดับสมาชิก
                    </Label>
                    <Select
                      value={editM.tier}
                      onValueChange={v =>
                        setEditM({ ...editM, tier: v as typeof editM.tier })
                      }
                    >
                      <SelectTrigger className="w-full bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="silver">ซิลเวอร์</SelectItem>
                        <SelectItem value="gold">โกลด์</SelectItem>
                        <SelectItem value="platinum">แพลทินัม</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-4 py-3.5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-3.5">
            <Button
              className="w-full"
              disabled={!editM?.name || updateMut.isPending}
              onClick={() => editM && updateMut.mutate(editM)}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog จัดการสมาชิก */}
      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden border-0 bg-slate-50 p-0 shadow-2xl sm:max-w-md sm:rounded-2xl [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:p-2 [&_[data-slot=dialog-close]]:text-white [&_[data-slot=dialog-close]]:opacity-80 [&_[data-slot=dialog-close]]:hover:bg-white/10 [&_[data-slot=dialog-close]]:hover:opacity-100">
          <DialogHeader className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 px-5 py-5 pr-14 text-left text-white sm:px-6">
            <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 left-1/3 size-44 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="relative flex items-center gap-3.5">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner">
                <Users className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">
                    Member detail
                  </span>
                </div>
                <DialogTitle className="font-heading text-xl font-bold leading-tight text-white">
                  {selected?.name}{" "}
                  <span className="text-sm font-normal text-blue-100/80">
                    ({selected?.memberCode})
                  </span>
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed text-blue-100/80 sm:text-sm">
                  แลกของรางวัล ปรับแต้ม และตรวจสอบประวัติแต้มของสมาชิก
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {selected && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50/80 p-4 sm:p-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <Gift className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      แต้มและของรางวัล
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      แต้มคงเหลือและรายการแลกรางวัล
                    </p>
                  </div>
                </div>
                <div className="space-y-4 p-4">
                  <div className="flex items-center gap-4 bg-blue-50 rounded-xl p-3">
                    <div>
                      <div className="text-xs text-muted-foreground">
                        แต้มคงเหลือ
                      </div>
                      <div className="font-heading text-2xl font-bold text-primary">
                        {selected.points}
                      </div>
                    </div>
                    <Badge
                      className={`${tierColor[selected.tier]} text-white ml-auto`}
                    >
                      {tierLabel[selected.tier]}
                    </Badge>
                  </div>
                  <div
                    className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                      selectedExpired
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {selectedExpired ? "บัตรหมดอายุเมื่อ" : "บัตรใช้ได้ถึง"}{" "}
                    {fmtDateTH(selected.cardExpiresAt)}
                    {selectedExpired && " · แต้มถูกตัดเป็น 0 และใช้บัตรไม่ได้"}
                  </div>

                  {/* แลกของรางวัล */}
                  <div>
                    <div className="text-sm font-medium mb-2">แลกของรางวัล</div>
                    <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto">
                      {(rewardList ?? [])
                        .filter(r => r.active && r.stock > 0)
                        .map(r => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between border rounded-lg px-3 py-1.5 text-sm"
                          >
                            <span>
                              {r.name}{" "}
                              <span className="text-xs text-muted-foreground">
                                ({r.pointsRequired} แต้ม)
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant={
                                selected.points >= r.pointsRequired
                                  ? "default"
                                  : "outline"
                              }
                              disabled={
                                selectedExpired ||
                                selected.points < r.pointsRequired ||
                                redeemMut.isPending
                              }
                              onClick={() =>
                                redeemMut.mutate({
                                  memberId: selected.id,
                                  rewardId: r.id,
                                })
                              }
                            >
                              แลก
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* ปรับแต้ม (admin) */}
              {isAdmin && (
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                  <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Star className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        ปรับแต้ม (แอดมิน)
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        เพิ่มหรือหักแต้มพร้อมระบุเหตุผล
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        placeholder="+/-"
                        value={adjustPts}
                        onChange={e => setAdjustPts(e.target.value)}
                        className="w-24 bg-white"
                      />
                      <Input
                        placeholder="เหตุผล"
                        value={adjustNote}
                        onChange={e => setAdjustNote(e.target.value)}
                        className="bg-white"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        selectedExpired ||
                        !adjustPts ||
                        !adjustNote ||
                        adjustMut.isPending
                      }
                      onClick={() =>
                        adjustMut.mutate({
                          memberId: selected.id,
                          points: Number(adjustPts),
                          note: adjustNote,
                        })
                      }
                    >
                      บันทึกปรับแต้ม
                    </Button>
                  </div>
                </section>
              )}

              {/* ประวัติแต้ม */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                    <History className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      ประวัติแต้มล่าสุด
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      รายการเคลื่อนไหวรวมจากทุกสาขา
                    </p>
                  </div>
                </div>
                <div className="p-4">
                  <div className="divide-y text-sm max-h-40 overflow-y-auto">
                    {(txns ?? []).map(t => (
                      <div
                        key={t.id}
                        className="py-1.5 flex justify-between gap-2"
                      >
                        <div>
                          <div className="text-xs text-muted-foreground">
                            {fmtDateTime(t.createdAt)} · {t.branchName}
                          </div>
                          <div>{t.note}</div>
                        </div>
                        <span
                          className={`font-semibold ${t.points >= 0 ? "text-green-600" : "text-destructive"}`}
                        >
                          {t.points >= 0 ? "+" : ""}
                          {t.points}
                        </span>
                      </div>
                    ))}
                    {(txns ?? []).length === 0 && (
                      <p className="text-xs text-muted-foreground py-3 text-center">
                        ยังไม่มีประวัติ
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <MemberCardDialog
        member={cardMember}
        open={!!cardMember}
        onOpenChange={open => !open && setCardMember(null)}
        settingMap={settingMap}
        logoUrl={logoUrl}
      />
      <CustomerLoyaltyQrDialog
        open={showCustomerQr}
        onOpenChange={setShowCustomerQr}
        url={customerLoyaltyUrl}
        shopName={settingMap?.shop_name?.trim() || "MEMBER CLUB"}
      />
    </div>
  );
}
