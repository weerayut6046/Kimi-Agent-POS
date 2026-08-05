import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  History,
  Minus,
  Package,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Smartphone,
  TriangleAlert,
  Wifi,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAppConfirm } from "@/components/AppConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useStaff } from "@/hooks/useStaff";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { trpc } from "@/providers/trpc";

type CountScope = "all" | "lubricant" | "other";
type CategoryFilter = CountScope;

const scopeLabels: Record<CountScope, string> = {
  all: "น้ำมันเครื่องและสินค้าในร้าน",
  lubricant: "น้ำมันเครื่อง / น้ำมันหล่อลื่น",
  other: "สินค้าในร้าน",
};

const statusLabels = {
  counting: "กำลังนับ",
  completed: "ยืนยันแล้ว",
  cancelled: "ยกเลิก",
} as const;

function statusBadgeClass(status: keyof typeof statusLabels): string {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "cancelled") {
    return "border-slate-200 bg-slate-100 text-slate-600";
  }
  return "border-cyan-200 bg-cyan-50 text-cyan-700";
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function StockCount() {
  const params = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const confirmAction = useAppConfirm();
  const utils = trpc.useUtils();
  const { staff } = useStaff();
  const sessionId = params.sessionId ? Number(params.sessionId) : null;
  const hasValidSessionId =
    sessionId != null && Number.isInteger(sessionId) && sessionId > 0;
  const canManage = staff?.role === "admin" || staff?.role === "manager";

  const [name, setName] = useState("");
  const [scope, setScope] = useState<CountScope>("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [remainingOnly, setRemainingOnly] = useState(false);
  const [showBookQty, setShowBookQty] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [localLanUrls, setLocalLanUrls] = useState<string[]>([]);
  const [localLanReachable, setLocalLanReachable] = useState(false);

  const sessionsQuery = trpc.stockCount.listSessions.useQuery(undefined, {
    retry: 1,
    refetchInterval: query =>
      hasValidSessionId || query.state.status === "error" ? false : 5_000,
  });
  const sessionQuery = trpc.stockCount.getSession.useQuery(
    { id: sessionId ?? 0 },
    {
      enabled: hasValidSessionId,
      retry: 1,
      refetchInterval: query =>
        query.state.status === "error" ? false : 3_000,
    }
  );
  const lanInfoQuery = trpc.catalog.lanInfo.useQuery(undefined, {
    staleTime: 60_000,
  });

  const createMutation = trpc.stockCount.createSession.useMutation();
  const saveMutation = trpc.stockCount.saveItemCount.useMutation();
  const completeMutation = trpc.stockCount.completeSession.useMutation();
  const cancelMutation = trpc.stockCount.cancelSession.useMutation();

  const session = sessionQuery.data;
  const openSession = sessionsQuery.data?.find(
    item => item.status === "counting"
  );
  const progress = session?.summary.totalItems
    ? (session.summary.countedItems / session.summary.totalItems) * 100
    : 0;

  const shareUrls = useMemo(() => {
    if (!session) return [];
    const path = `/stock/count/${session.id}`;
    const urls = [
      ...localLanUrls,
      ...(lanInfoQuery.data?.urls ?? []),
    ].map(url => `${url}${path}`);
    if (
      typeof window !== "undefined" &&
      /^https?:$/.test(window.location.protocol) &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      urls.unshift(`${window.location.origin}${path}`);
    }
    return [...new Set(urls)];
  }, [lanInfoQuery.data?.urls, localLanUrls, session]);
  const primaryShareUrl = shareUrls[0] ?? "";

  useEffect(() => {
    let active = true;
    void fetch("/api/lan-info", { cache: "no-store" })
      .then(async response => {
        if (!response.ok) return null;
        return (await response.json()) as {
          urls?: unknown;
          reachable?: unknown;
        };
      })
      .then(result => {
        if (!active || !Array.isArray(result?.urls)) return;
        setLocalLanUrls(
          result.urls.filter((url): url is string => typeof url === "string")
        );
        setLocalLanReachable(result.reachable === true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!primaryShareUrl) {
      return;
    }
    void QRCode.toDataURL(primaryShareUrl, {
      width: 320,
      margin: 2,
      color: { dark: "#171344", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then(url => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl("");
      });
    return () => {
      active = false;
    };
  }, [primaryShareUrl]);

  const visibleItems = useMemo(() => {
    if (!session) return [];
    const keyword = search.trim().toLocaleLowerCase("th-TH");
    return session.items.filter(item => {
      if (category !== "all" && item.category !== category) return false;
      if (remainingOnly && item.countedQty != null) return false;
      if (!keyword) return true;
      return `${item.productCode} ${item.productName}`
        .toLocaleLowerCase("th-TH")
        .includes(keyword);
    });
  }, [category, remainingOnly, search, session]);

  const createSession = async () => {
    setError("");
    try {
      const created = await createMutation.mutateAsync({
        name: name.trim() || undefined,
        scope,
      });
      await utils.stockCount.listSessions.invalidate();
      navigate(`/stock/count/${created.id}`);
      toast.success("เริ่มรอบนับสต๊อกแล้ว");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เริ่มรอบนับไม่สำเร็จ");
    }
  };

  const itemDraft = (item: NonNullable<typeof session>["items"][number]) =>
    drafts[item.id] ?? (item.countedQty == null ? "" : String(item.countedQty));

  const adjustDraft = (
    item: NonNullable<typeof session>["items"][number],
    delta: number
  ) => {
    const parsed = Number(itemDraft(item));
    const base = Number.isFinite(parsed) ? parsed : 0;
    setDrafts(current => ({
      ...current,
      [item.id]: String(Math.max(0, base + delta)),
    }));
  };

  const saveItem = async (
    item: NonNullable<typeof session>["items"][number]
  ) => {
    if (!session) return;
    const value = Number(itemDraft(item));
    if (!Number.isFinite(value) || value < 0) {
      setError(`กรุณากรอกจำนวนของ ${item.productName} ให้ถูกต้อง`);
      return;
    }
    setError("");
    try {
      await saveMutation.mutateAsync({
        sessionId: session.id,
        itemId: item.id,
        countedQty: value,
        note: item.note ?? undefined,
      });
      setDrafts(current => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await Promise.all([
        utils.stockCount.getSession.invalidate({ id: session.id }),
        utils.stockCount.listSessions.invalidate(),
      ]);
      toast.success(`บันทึก ${item.productCode} แล้ว`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกจำนวนไม่สำเร็จ");
    }
  };

  const completeSession = async () => {
    if (!session) return;
    const confirmed = await confirmAction({
      title: "ยืนยันและปรับยอดสต๊อก",
      description: `ระบบจะปรับยอดสินค้าทั้ง ${session.summary.totalItems} รายการตามจำนวนที่นับจริง การขายที่เกิดระหว่างนับอาจทำให้ยอดคลาดเคลื่อน`,
      confirmLabel: "ยืนยันปรับยอด",
      variant: "warning",
    });
    if (!confirmed) return;
    setError("");
    try {
      await completeMutation.mutateAsync({ id: session.id });
      await Promise.all([
        utils.stockCount.getSession.invalidate({ id: session.id }),
        utils.stockCount.listSessions.invalidate(),
        utils.catalog.listProducts.invalidate(),
      ]);
      toast.success("ยืนยันรอบนับและปรับยอดสต๊อกแล้ว");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ยืนยันรอบนับไม่สำเร็จ"
      );
    }
  };

  const cancelSession = async () => {
    if (!session) return;
    const confirmed = await confirmAction({
      title: "ยกเลิกรอบนับนี้?",
      description:
        "จำนวนที่นับไว้จะยังอยู่ในประวัติ แต่จะไม่ถูกนำไปปรับยอดสต๊อก",
      confirmLabel: "ยกเลิกรอบนับ",
      variant: "danger",
    });
    if (!confirmed) return;
    setError("");
    try {
      await cancelMutation.mutateAsync({ id: session.id });
      await Promise.all([
        utils.stockCount.getSession.invalidate({ id: session.id }),
        utils.stockCount.listSessions.invalidate(),
      ]);
      toast.success("ยกเลิกรอบนับแล้ว");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ยกเลิกรอบนับไม่สำเร็จ"
      );
    }
  };

  if (params.sessionId && !hasValidSessionId) {
    return (
      <Card>
        <CardContent className="grid min-h-64 place-items-center p-8 text-center">
          <div>
            <TriangleAlert className="mx-auto size-10 text-amber-500" />
            <h1 className="mt-3 font-heading text-lg font-bold">
              ลิงก์รอบนับไม่ถูกต้อง
            </h1>
            <Button asChild className="mt-5">
              <Link to="/stock/count">กลับหน้ารอบนับ</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasValidSessionId) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="icon" variant="outline" className="rounded-xl">
            <Link to="/stock" aria-label="กลับหน้าสต๊อก">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="page-heading">นับสต๊อกผ่านมือถือ</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              มือถือทุกเครื่องใน Wi‑Fi เดียวกันช่วยกันนับรอบเดียวได้
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {openSession && (
          <Card className="overflow-hidden border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-violet-50">
            <CardContent className="p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-cyan-500 text-white shadow-lg shadow-cyan-200">
                  <ClipboardCheck className="size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <Badge className="border-cyan-200 bg-white text-cyan-700">
                    กำลังนับอยู่
                  </Badge>
                  <h2 className="mt-2 truncate font-heading text-lg font-bold">
                    {openSession.name}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    นับแล้ว {openSession.summary.countedItems}/
                    {openSession.summary.totalItems} รายการ · เริ่มโดย{" "}
                    {openSession.startedByName}
                  </p>
                </div>
                <Button asChild className="h-11 rounded-xl">
                  <Link to={`/stock/count/${openSession.id}`}>
                    นับต่อ <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {canManage && !openSession && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-heading text-base">
                <ClipboardList className="size-4 text-violet-600" />
                เริ่มรอบนับใหม่
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="count-name">ชื่อรอบนับ (ไม่บังคับ)</Label>
                <Input
                  id="count-name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="เช่น นับสินค้าสิ้นเดือน สิงหาคม"
                  maxLength={120}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label>ประเภทสินค้าที่นับ</Label>
                <Select
                  value={scope}
                  onValueChange={value => setScope(value as CountScope)}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{scopeLabels.all}</SelectItem>
                    <SelectItem value="lubricant">
                      {scopeLabels.lubricant}
                    </SelectItem>
                    <SelectItem value="other">{scopeLabels.other}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                ควรหยุดขายสินค้าที่กำลังนับชั่วคราว
                เพื่อไม่ให้ยอดเปลี่ยนระหว่างการตรวจนับ
              </div>
              <Button
                className="h-12 w-full rounded-xl text-base sm:w-auto"
                disabled={createMutation.isPending}
                onClick={() => void createSession()}
              >
                <Plus className="size-4" />
                {createMutation.isPending
                  ? "กำลังเริ่มรอบ..."
                  : "เริ่มนับสต๊อก"}
              </Button>
            </CardContent>
          </Card>
        )}

        {!canManage && !openSession && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              <ClipboardList className="mx-auto mb-3 size-9 text-slate-300" />
              ยังไม่มีรอบนับที่เปิดอยู่
              กรุณาให้ผู้จัดการหรือผู้ดูแลระบบเริ่มรอบใหม่
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <History className="size-4" /> ประวัติรอบนับ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(sessionsQuery.data ?? []).map(item => (
              <Link
                key={item.id}
                to={`/stock/count/${item.id}`}
                className="flex items-center gap-3 rounded-2xl border bg-white p-3 transition hover:border-violet-200 hover:bg-violet-50/40"
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                  {item.status === "completed" ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : item.status === "cancelled" ? (
                    <XCircle className="size-5" />
                  ) : (
                    <ClipboardCheck className="size-5 text-cyan-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{item.name}</span>
                    <Badge
                      variant="outline"
                      className={statusBadgeClass(item.status)}
                    >
                      {statusLabels[item.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {fmtDateTime(item.startedAt)} · {item.summary.countedItems}/
                    {item.summary.totalItems} รายการ
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-slate-400" />
              </Link>
            ))}
            {sessionsQuery.isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                กำลังโหลดรอบนับ...
              </p>
            )}
            {!sessionsQuery.isLoading &&
              (sessionsQuery.data?.length ?? 0) === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  ยังไม่มีประวัติรอบนับ
                </p>
              )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="grid min-h-64 place-items-center">
        <span className="size-7 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <TriangleAlert className="mx-auto size-10 text-amber-500" />
          <h1 className="mt-3 font-heading text-lg font-bold">
            {sessionQuery.error?.message ?? "ไม่พบรอบนับสต๊อก"}
          </h1>
          <Button asChild className="mt-5">
            <Link to="/stock/count">กลับหน้ารอบนับ</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isCounting = session.status === "counting";

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start gap-3">
        <Button
          asChild
          size="icon"
          variant="outline"
          className="shrink-0 rounded-xl"
        >
          <Link to="/stock/count" aria-label="กลับหน้ารอบนับ">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-heading truncate">{session.name}</h1>
            <Badge
              variant="outline"
              className={statusBadgeClass(session.status)}
            >
              {statusLabels[session.status]}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            รอบ #{session.id} · {scopeLabels[session.scope]} · เริ่มโดย{" "}
            {session.startedByName}
          </p>
        </div>
      </div>

      {(error || sessionQuery.error) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error || sessionQuery.error?.message}
        </div>
      )}

      <Card className="overflow-hidden border-violet-100 bg-gradient-to-br from-white via-violet-50/40 to-cyan-50/50">
        <CardContent className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    ความคืบหน้า
                  </div>
                  <div className="mt-1 font-heading text-2xl font-bold text-slate-900">
                    {session.summary.countedItems}
                    <span className="text-base font-medium text-slate-400">
                      /{session.summary.totalItems} รายการ
                    </span>
                  </div>
                </div>
                <span className="font-heading text-lg font-bold text-violet-700">
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress value={progress} className="mt-3 h-2.5" />
            </div>
            <div className="rounded-2xl border border-white bg-white/70 p-3 shadow-sm">
              <div className="text-[11px] text-slate-500">ยังไม่ได้นับ</div>
              <div className="mt-1 font-heading text-xl font-bold text-amber-600">
                {session.summary.remainingItems}
              </div>
            </div>
            <div className="rounded-2xl border border-white bg-white/70 p-3 shadow-sm">
              <div className="text-[11px] text-slate-500">
                รายการต่างจากระบบ
              </div>
              <div className="mt-1 font-heading text-xl font-bold text-rose-600">
                {session.summary.varianceItems}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {isCounting && (
        <Card className="border-cyan-100">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <Wifi className="size-4 text-cyan-600" /> เปิดนับบนมือถือผ่าน
              Wi‑Fi
            </CardTitle>
          </CardHeader>
          <CardContent>
            {primaryShareUrl ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {qrDataUrl && (
                  <div className="mx-auto rounded-2xl border bg-white p-2 shadow-sm sm:mx-0">
                    <img
                      src={qrDataUrl}
                      alt="QR Code สำหรับเปิดรอบนับบนมือถือ"
                      className="size-36"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Smartphone className="size-4 text-violet-600" />
                    มือถือต่อ Wi‑Fi วงเดียวกับเครื่องหลัก แล้วสแกน QR
                  </div>
                  <code className="mt-3 block break-all rounded-xl bg-slate-100 p-3 text-xs text-slate-700">
                    {primaryShareUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 rounded-xl"
                    onClick={() => {
                      void copyText(primaryShareUrl).then(() =>
                        toast.success("คัดลอกลิงก์แล้ว")
                      );
                    }}
                  >
                    <Copy className="size-3.5" /> คัดลอกลิงก์
                  </Button>
                  {!localLanReachable && !lanInfoQuery.data?.enabled && (
                    <p className="mt-3 text-xs leading-5 text-amber-700">
                      หากมือถือเปิดไม่ได้ ให้เปิด “เครือข่าย LAN” ในหน้าตั้งค่า
                      และรันระบบด้วย npm run dev:lan หรือ npm start
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <QrCode className="mt-0.5 size-5 shrink-0" />
                <div>
                  ยังไม่พบ IP ของเครื่องหลัก กรุณาเชื่อมต่อ Wi‑Fi
                  แล้วเปิดเครือข่าย LAN ในหน้าตั้งค่า จากนั้นรันด้วย npm run
                  dev:lan หรือ npm start
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="sticky top-[calc(64px+env(safe-area-inset-top))] z-10 space-y-3 rounded-2xl border border-white/90 bg-white/90 p-3 shadow-lg shadow-slate-200/60 backdrop-blur-xl lg:top-[92px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="ค้นหารหัสหรือชื่อสินค้า"
            className="h-11 pl-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "lubricant", "other"] as const).map(value => (
            <Button
              key={value}
              size="sm"
              type="button"
              variant={category === value ? "default" : "outline"}
              className="h-9 rounded-xl text-xs"
              onClick={() => setCategory(value)}
            >
              {value === "all"
                ? "ทั้งหมด"
                : value === "lubricant"
                  ? "น้ำมันเครื่อง"
                  : "สินค้าในร้าน"}
            </Button>
          ))}
          <label className="ml-auto flex min-h-9 items-center gap-2 rounded-xl border px-3 text-xs">
            <Switch
              checked={remainingOnly}
              onCheckedChange={setRemainingOnly}
              className="scale-90"
            />
            เฉพาะที่ยังไม่ได้นับ
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 rounded-xl text-xs"
            onClick={() => setShowBookQty(value => !value)}
          >
            {showBookQty ? (
              <EyeOff className="size-3.5" />
            ) : (
              <Eye className="size-3.5" />
            )}
            {showBookQty ? "ซ่อนยอดระบบ" : "แสดงยอดระบบ"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {visibleItems.map(item => {
          const draft = itemDraft(item);
          const isSaved = item.countedQty != null;
          const isDirty = drafts[item.id] !== undefined;
          const difference = item.difference;
          return (
            <Card
              key={item.id}
              className={`overflow-hidden ${
                isSaved ? "border-emerald-100" : "border-amber-100"
              }`}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div
                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                      item.category === "lubricant"
                        ? "bg-violet-100 text-violet-700"
                        : "bg-cyan-100 text-cyan-700"
                    }`}
                  >
                    <Package className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-500">
                        {item.productCode}
                      </span>
                      <Badge variant="secondary" className="text-[10px]">
                        {item.category === "lubricant"
                          ? "น้ำมันเครื่อง"
                          : "สินค้าในร้าน"}
                      </Badge>
                      {isSaved && (
                        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          <Check className="size-3" /> นับแล้ว
                        </Badge>
                      )}
                    </div>
                    <h2 className="mt-1 font-heading text-base font-bold text-slate-900 sm:text-lg">
                      {item.productName}
                    </h2>
                    <div className="mt-1 min-h-5 text-xs text-muted-foreground">
                      {showBookQty || !isCounting ? (
                        <>
                          ยอดในระบบ {fmtNum(item.expectedQty)} {item.unit}
                          {difference != null && (
                            <span
                              className={`ml-2 font-semibold ${
                                difference === 0
                                  ? "text-emerald-600"
                                  : "text-rose-600"
                              }`}
                            >
                              · ต่าง {difference > 0 ? "+" : ""}
                              {fmtNum(difference)} {item.unit}
                            </span>
                          )}
                        </>
                      ) : (
                        "โหมดนับจริง — ซ่อนยอดในระบบ"
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2 sm:grid-cols-[44px_minmax(160px,240px)_44px_minmax(120px,1fr)]">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-xl"
                    disabled={!isCounting}
                    aria-label={`ลดจำนวน ${item.productName}`}
                    onClick={() => adjustDraft(item, -1)}
                  >
                    <Minus className="size-5" />
                  </Button>
                  <div className="relative">
                    <Input
                      value={draft}
                      disabled={!isCounting}
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      aria-label={`จำนวนที่นับได้ของ ${item.productName}`}
                      placeholder="จำนวนที่นับได้"
                      className="h-12 rounded-xl pr-14 text-center font-heading text-xl font-bold tabular-nums"
                      onChange={event =>
                        setDrafts(current => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      onKeyDown={event => {
                        if (event.key === "Enter") void saveItem(item);
                      }}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                      {item.unit}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-xl"
                    disabled={!isCounting}
                    aria-label={`เพิ่มจำนวน ${item.productName}`}
                    onClick={() => adjustDraft(item, 1)}
                  >
                    <Plus className="size-5" />
                  </Button>
                  {isCounting && (
                    <Button
                      type="button"
                      className="col-span-3 h-12 rounded-xl sm:col-span-1"
                      disabled={
                        saveMutation.isPending ||
                        draft.trim() === "" ||
                        (!isDirty && isSaved)
                      }
                      onClick={() => void saveItem(item)}
                    >
                      <Check className="size-4" />
                      {isSaved ? "บันทึกจำนวนใหม่" : "บันทึกจำนวน"}
                    </Button>
                  )}
                </div>

                {item.countedByName && (
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    บันทึกล่าสุดโดย {item.countedByName}
                    {item.countedAt ? ` · ${fmtDateTime(item.countedAt)}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {visibleItems.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              <Search className="mx-auto mb-3 size-8 text-slate-300" />
              ไม่พบสินค้าตามตัวกรอง
            </CardContent>
          </Card>
        )}
      </div>

      {isCounting && canManage && (
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-white">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
            <div className="min-w-0 flex-1">
              <h2 className="font-heading font-bold">ตรวจสอบและปิดรอบนับ</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                ต้องนับครบทุกสินค้าก่อนจึงจะยืนยันปรับยอดสต๊อกได้
              </p>
            </div>
            <Button
              variant="outline"
              className="h-11 rounded-xl text-red-600"
              disabled={cancelMutation.isPending}
              onClick={() => void cancelSession()}
            >
              <XCircle className="size-4" /> ยกเลิกรอบ
            </Button>
            <Button
              className="h-11 rounded-xl"
              disabled={
                session.summary.remainingItems > 0 || completeMutation.isPending
              }
              onClick={() => void completeSession()}
            >
              <CheckCircle2 className="size-4" /> ยืนยันและปรับยอด
            </Button>
          </CardContent>
        </Card>
      )}

      {!isCounting && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-heading font-bold">
                {session.status === "completed" ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : (
                  <XCircle className="size-5 text-slate-500" />
                )}
                {session.status === "completed"
                  ? "รอบนับนี้ยืนยันและปรับยอดแล้ว"
                  : "รอบนับนี้ถูกยกเลิก"}
              </div>
              {session.completedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtDateTime(session.completedAt)} · {session.completedByName}
                </p>
              )}
            </div>
            <Button asChild variant="outline" className="h-11 rounded-xl">
              <Link to="/stock/count">
                <RotateCcw className="size-4" /> ดูรอบนับทั้งหมด
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
