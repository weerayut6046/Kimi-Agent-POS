import QRCode from "qrcode";
import "@/index.css";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ArrowLeft,
  Camera,
  Clock3,
  ExternalLink,
  ImageUp,
  LogIn,
  LogOut,
  QrCode,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FaceCapture,
  type FaceCaptureResult,
  type FaceLivenessAction,
} from "@/components/FaceCapture";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useStaff } from "@/hooks/useStaff";
import {
  attendanceQrUrl,
  attendanceTokenFromPayload,
} from "@/lib/attendanceQr";
import { loadFaceEngine } from "@/lib/faceRecognition";
import { decodeQrImageFile, decodeQrPixels } from "@/lib/qrImageDecoder";
import { trpc } from "@/providers/trpc";

type AttendanceAction = "clock_in" | "clock_out";
type Challenge = {
  token: string;
  expiresAt: Date;
  branchId: number;
  branchName: string;
};
type FaceChallenge = {
  token: string;
  expiresAt: Date;
  livenessAction: FaceLivenessAction;
  attendanceAction: AttendanceAction;
  staffName: string;
};

const KIOSK_QR_REFRESH_MS = 30_000;

function bangkokToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function thaiDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

function thaiTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

function actionText(action: AttendanceAction): string {
  return action === "clock_in" ? "เข้างาน" : "ออกงาน";
}

function methodText(method: string | null | undefined): string {
  if (method === "qr") return "QR";
  if (method === "face") return "ใบหน้า";
  if (method === "manual") return "ผู้จัดการบันทึก";
  return "—";
}

function tokenFromLocation(): string | null {
  const token = new URLSearchParams(window.location.search).get("token");
  return token ? attendanceTokenFromPayload(token) : null;
}

function AttendanceKiosk() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const kioskToken =
    new URLSearchParams(window.location.search).get("access")?.trim() || null;
  const canDisplay = canManage || Boolean(kioskToken);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [nextRefreshAt, setNextRefreshAt] = useState(() => Date.now());
  const issueManagerChallenge = trpc.attendance.issueQrChallenge.useMutation({
    onSuccess: value => setChallenge(value),
  });
  const issuePublicChallenge =
    trpc.attendance.issuePublicQrChallenge.useMutation({
      onSuccess: value => setChallenge(value),
    });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!canDisplay) return;
    const refresh = () => {
      setNextRefreshAt(Date.now() + KIOSK_QR_REFRESH_MS);
      if (kioskToken) {
        issuePublicChallenge.mutate({ kioskToken });
      } else {
        issueManagerChallenge.mutate();
      }
    };
    refresh();
    const timer = window.setInterval(refresh, KIOSK_QR_REFRESH_MS);
    return () => window.clearInterval(timer);
    // mutate is stable for the lifetime of this mounted mutation observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDisplay, kioskToken]);

  useEffect(() => {
    let active = true;
    if (!challenge) return;
    const url = attendanceQrUrl(window.location.origin, challenge.token);
    void QRCode.toDataURL(url, {
      width: 460,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#11112b", light: "#ffffff" },
    }).then(value => active && setQrImage(value));
    return () => {
      active = false;
    };
  }, [challenge]);

  if (!canDisplay) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center text-white">
        <Card className="w-full max-w-md border-white/10 bg-white/10 text-white">
          <CardHeader>
            <CardTitle>ลิงก์จอ QR ไม่ถูกต้อง</CardTitle>
            <CardDescription className="text-slate-300">
              ให้ผู้ดูแลระบบหรือผู้จัดการเปิดจอนี้จากหน้าลงเวลาอีกครั้ง
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <a href="/attendance">
                <ArrowLeft /> กลับหน้าลงเวลา
              </a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const secondsLeft = challenge
    ? Math.max(0, Math.ceil((challenge.expiresAt.getTime() - now) / 1_000))
    : 0;
  const refreshSeconds = Math.max(0, Math.ceil((nextRefreshAt - now) / 1_000));
  const refreshProgress = Math.max(
    0,
    Math.min(100, (refreshSeconds / (KIOSK_QR_REFRESH_MS / 1_000)) * 100)
  );
  const challengeError =
    issueManagerChallenge.error || issuePublicChallenge.error;
  const branchName =
    challenge?.branchName ?? staff?.branch.name ?? "จอ QR ประจำสาขา";

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#f6f5fb] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-slate-950 sm:px-6 sm:py-6 lg:grid lg:place-items-center">
      <div className="surface-dots pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -left-28 top-0 size-72 rounded-full bg-violet-300/25 blur-3xl sm:size-96" />
      <div className="pointer-events-none absolute -right-28 bottom-0 size-72 rounded-full bg-cyan-300/20 blur-3xl sm:size-96" />

      <section className="relative mx-auto w-full max-w-6xl">
        <header className="mb-3 flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur-xl sm:mb-5 sm:rounded-3xl sm:px-5 sm:py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-lg shadow-violet-600/20 sm:size-11 sm:rounded-2xl">
              <QrCode className="size-5 sm:size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-600 sm:text-xs">
                PumpPOS <span className="text-slate-300">•</span> Attendance
              </div>
              <h1 className="truncate font-heading text-base font-black text-slate-950 sm:text-xl">
                {branchName}
              </h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 sm:flex">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
              จอพร้อมใช้งาน
            </div>
            {staff && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl bg-white"
                asChild
              >
                <a href="/attendance">
                  <ArrowLeft />
                  <span className="hidden sm:inline">กลับหน้าลงเวลา</span>
                </a>
              </Button>
            )}
          </div>
        </header>

        <div className="grid gap-3 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,470px)] lg:items-stretch">
          <section className="order-2 overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-900 p-5 text-white shadow-xl shadow-indigo-950/15 sm:rounded-[32px] sm:p-8 lg:order-1 lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-cyan-200 sm:text-sm">
                <ShieldCheck className="size-4" /> ระบบลงเวลาเข้า–ออกงาน
              </div>
              <div className="mt-3 font-heading text-4xl font-black tabular-nums tracking-[-0.04em] sm:mt-5 sm:text-6xl lg:text-7xl">
                {new Date(now).toLocaleTimeString("th-TH", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Bangkok",
                })}
              </div>
              <p className="mt-1 text-sm font-medium text-indigo-200 sm:mt-2 sm:text-base">
                {new Date(now).toLocaleDateString("th-TH", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "Asia/Bangkok",
                })}
              </p>
              <p className="mt-4 max-w-xl text-sm leading-6 text-indigo-100 sm:text-lg sm:leading-8">
                เปิดแอป PumpPOS บนมือถือ สแกน QR
                แล้วตรวจใบหน้าเพื่อเข้างานหรือออกงาน
              </p>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 sm:mt-8 sm:gap-3">
              {[
                [Smartphone, "1", "เปิดบนมือถือ"],
                [QrCode, "2", "สแกน QR"],
                [ScanFace, "3", "สแกนใบหน้า"],
              ].map(([Icon, step, label]) => {
                const StepIcon = Icon as typeof Smartphone;
                return (
                  <div
                    key={String(step)}
                    className="rounded-2xl border border-white/10 bg-white/[0.08] p-3 backdrop-blur sm:p-4"
                  >
                    <div className="flex items-center justify-between gap-1 text-cyan-200">
                      <StepIcon className="size-5" />
                      <span className="grid size-5 place-items-center rounded-full bg-white/10 text-[10px] font-black">
                        {String(step)}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] font-bold leading-4 text-white sm:text-sm">
                      {String(label)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-2xl bg-black/15 px-3 py-2.5 text-[11px] leading-5 text-indigo-200 sm:mt-6 sm:text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-300" />
              QR ใช้ได้เฉพาะสาขานี้และเปลี่ยนอัตโนมัติ ไม่ควรถ่ายภาพส่งต่อ
            </div>
          </section>

          <section className="order-1 rounded-[28px] border border-white/90 bg-white p-3 shadow-xl shadow-violet-950/10 sm:rounded-[32px] sm:p-5 lg:order-2">
            <div className="mb-2.5 flex items-center justify-between gap-3 px-1 sm:mb-4">
              <div>
                <div className="text-xs font-bold text-violet-600">
                  QR ประจำสาขา
                </div>
                <div className="mt-0.5 text-sm font-black text-slate-900 sm:text-base">
                  สแกนด้วยกล้องโทรศัพท์
                </div>
              </div>
              <div
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ${
                  qrImage && secondsLeft > 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                <span
                  className={`size-2 rounded-full ${
                    qrImage && secondsLeft > 0
                      ? "animate-pulse bg-emerald-500"
                      : "bg-amber-500"
                  }`}
                />
                {qrImage && secondsLeft > 0 ? "พร้อมสแกน" : "กำลังเตรียม"}
              </div>
            </div>

            <div className="mx-auto w-full max-w-[390px] rounded-[24px] bg-gradient-to-br from-violet-100 via-white to-cyan-100 p-2.5 sm:rounded-[28px] sm:p-3.5">
              <div className="grid aspect-square place-items-center overflow-hidden rounded-[18px] bg-white p-2 shadow-sm ring-1 ring-slate-200/70 sm:rounded-[22px] sm:p-3">
                {qrImage && secondsLeft > 0 ? (
                  <img
                    src={qrImage}
                    alt="QR ลงเวลาทำงาน"
                    className="aspect-square size-full object-contain"
                  />
                ) : issueManagerChallenge.isPending ||
                  issuePublicChallenge.isPending ? (
                  <div className="text-center text-slate-500">
                    <RefreshCw className="mx-auto size-9 animate-spin text-violet-600 sm:size-11" />
                    <div className="mt-3 text-sm font-bold">
                      กำลังสร้าง QR...
                    </div>
                  </div>
                ) : (
                  <QrCode className="size-16 text-slate-300" />
                )}
              </div>
            </div>

            <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2.5 sm:mt-4 sm:px-4 sm:py-3">
              <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-600 sm:text-sm">
                <span className="flex items-center gap-2">
                  <Clock3 className="size-4 text-violet-600" />
                  เปลี่ยน QR อัตโนมัติ
                </span>
                <span className="tabular-nums text-violet-700">
                  {refreshSeconds} วินาที
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 transition-[width] duration-1000 ease-linear"
                  style={{ width: `${refreshProgress}%` }}
                />
              </div>
            </div>

            {challengeError && (
              <div
                role="alert"
                className="mt-3 rounded-2xl border border-red-100 bg-red-50 px-3 py-2.5 text-center text-xs font-semibold leading-5 text-red-700 sm:text-sm"
              >
                {challengeError.message}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function AttendanceSelfService() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const utils = trpc.useUtils();
  const status = trpc.attendance.myStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const branchAttendance = trpc.attendance.branchList.useQuery(
    { workDate: bangkokToday() },
    { enabled: canManage, refetchInterval: 30_000 }
  );
  const issueKioskAccess = trpc.attendance.issueKioskAccess.useMutation();
  const [pendingToken, setPendingToken] = useState<string | null>(
    tokenFromLocation
  );
  const [faceChallenge, setFaceChallenge] = useState<FaceChallenge | null>(
    null
  );
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const requestedTokenRef = useRef<string | null>(null);

  const openKioskScreen = () => {
    const popup = window.open("", "_blank");
    if (!popup) {
      toast.error(
        "เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง"
      );
      return;
    }
    popup.document.title = "กำลังเปิดจอ QR";
    popup.document.body.textContent = "กำลังสร้างลิงก์จอ QR ประจำสาขา...";
    issueKioskAccess.mutate(undefined, {
      onSuccess: value => {
        const url = new URL("/attendance/kiosk", window.location.origin);
        url.searchParams.set("access", value.token);
        popup.location.replace(url.toString());
      },
      onError: error => {
        popup.close();
        toast.error(error.message);
      },
    });
  };

  useEffect(() => {
    // Download and initialize local face models while the employee scans QR.
    // FaceCapture reuses this promise, removing most of the perceived wait.
    void loadFaceEngine().catch(() => undefined);
  }, []);

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }, []);

  const beginFaceVerification =
    trpc.attendance.beginFaceVerification.useMutation({
      onSuccess: value => setFaceChallenge(value),
      onError: error => {
        setPendingToken(null);
        requestedTokenRef.current = null;
        window.history.replaceState(null, "", "/attendance");
        setCameraError(error.message);
        toast.error(error.message);
      },
    });

  const completeFaceVerification =
    trpc.attendance.completeFaceVerification.useMutation({
      onSuccess: result => {
        stopCamera();
        setPendingToken(null);
        setFaceChallenge(null);
        requestedTokenRef.current = null;
        window.history.replaceState(null, "", "/attendance");
        void status.refetch();
        void branchAttendance.refetch();
        void utils.workforce.scheduleList.invalidate();
        toast.success(
          result.duplicate
            ? `รายการ${actionText(result.action)}ถูกบันทึกไว้แล้ว`
            : `${actionText(result.action)}สำเร็จ เวลา ${thaiTime(
                result.action === "clock_in"
                  ? result.session.clockInAt
                  : result.session.clockOutAt
              )}`
        );
      },
      onError: error => {
        setPendingToken(null);
        setFaceChallenge(null);
        requestedTokenRef.current = null;
        window.history.replaceState(null, "", "/attendance");
        setCameraError(error.message);
        toast.error(error.message);
      },
    });

  useEffect(() => stopCamera, [stopCamera]);

  const acceptPayload = useCallback(
    (payload: string) => {
      const token = attendanceTokenFromPayload(payload);
      if (!token) {
        setCameraError("QR นี้ไม่ใช่ QR ลงเวลาของ PumpPOS");
        return false;
      }
      stopCamera();
      setCameraError("");
      requestedTokenRef.current = null;
      setFaceChallenge(null);
      setPendingToken(token);
      return true;
    },
    [stopCamera]
  );

  const scanFrame = useCallback(async () => {
    if (scanBusyRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!streamRef.current || !video || !canvas) return;
    scanBusyRef.current = true;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const scale = Math.min(
          1,
          720 / Math.max(video.videoWidth, video.videoHeight)
        );
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const payload = await decodeQrPixels(
            image.data,
            canvas.width,
            canvas.height
          );
          if (payload) acceptPayload(payload);
        }
      }
    } finally {
      scanBusyRef.current = false;
    }
  }, [acceptPayload]);

  const startCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง กรุณาอัปโหลดรูป QR แทน"
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
        scanTimerRef.current = window.setInterval(() => void scanFrame(), 300);
      }
    } catch {
      stopCamera();
      setCameraError(
        "เปิดกล้องไม่สำเร็จ กรุณาอนุญาตใช้กล้องหรืออัปโหลดรูป QR แทน"
      );
    }
  };

  const uploadQr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const decoded = await decodeQrImageFile(file);
      acceptPayload(decoded.payload);
    } catch (error) {
      setCameraError(
        error instanceof Error ? error.message : "อ่าน QR ไม่สำเร็จ"
      );
    }
  };

  useEffect(() => {
    if (!pendingToken || requestedTokenRef.current === pendingToken) return;
    requestedTokenRef.current = pendingToken;
    beginFaceVerification.mutate({ qrToken: pendingToken });
    // mutate is stable for the lifetime of this mounted mutation observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToken]);

  const finishFaceCapture = useCallback(
    (result: FaceCaptureResult) => {
      if (!faceChallenge) return;
      completeFaceVerification.mutate({
        challengeToken: faceChallenge.token,
        embedding: result.embeddings[0]!,
        quality: result.quality,
      });
    },
    [completeFaceVerification, faceChallenge]
  );

  const nextAction = status.data?.nextAction ?? "clock_in";
  const openSession = status.data?.openSession;

  return (
    <main className="min-h-screen bg-[#f6f5fb] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-violet-600">
              <Clock3 className="size-4" /> Attendance
            </div>
            <h1 className="mt-1 font-heading text-2xl font-bold text-slate-950 sm:text-3xl">
              ลงเวลาเข้า–ออกงาน
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {staff?.name} · {staff?.branch.name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <>
                <Button variant="outline" asChild>
                  <a href="/attendance/enroll">
                    <UserRoundCheck /> ลงทะเบียนใบหน้า
                  </a>
                </Button>
                <Button
                  type="button"
                  disabled={issueKioskAccess.isPending}
                  onClick={openKioskScreen}
                >
                  {issueKioskAccess.isPending ? (
                    <RefreshCw className="animate-spin" />
                  ) : (
                    <ExternalLink />
                  )}
                  เปิดจอ QR ประจำสาขา
                </Button>
              </>
            )}
            <Button variant="outline" asChild>
              <a href="/">
                <ArrowLeft /> กลับหน้าหลัก
              </a>
            </Button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,.95fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-white to-violet-50/60">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    {nextAction === "clock_in" ? (
                      <LogIn className="size-5 text-emerald-600" />
                    ) : (
                      <LogOut className="size-5 text-orange-600" />
                    )}
                    {nextAction === "clock_in" ? "พร้อมเข้างาน" : "กำลังทำงาน"}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    {openSession
                      ? `เข้างานเมื่อ ${thaiDateTime(openSession.clockInAt)}`
                      : "สแกน QR ประจำสาขา แล้วสแกนใบหน้าเพื่อเข้างาน"}
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={
                    openSession
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }
                >
                  {openSession ? "อยู่ระหว่างงาน" : "ยังไม่เข้างาน"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingToken ? (
                <div className="rounded-[2rem] border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/5 sm:p-4">
                  <div className="mb-3 flex items-center gap-3 px-1">
                    <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 text-white shadow-lg shadow-violet-500/20">
                      <ScanFace className="size-6" />
                    </div>
                    <div>
                      <h2 className="font-bold text-slate-900">
                        สแกนใบหน้าเพื่อ
                        {actionText(
                          faceChallenge?.attendanceAction ?? nextAction
                        )}
                      </h2>
                      <p className="text-xs text-slate-500">
                        ทำตามคำแนะนำบนหน้าจอ ระบบจะบันทึกเวลาให้อัตโนมัติ
                      </p>
                    </div>
                  </div>
                  {faceChallenge ? (
                    <FaceCapture
                      mode="verify"
                      action={faceChallenge.livenessAction}
                      onComplete={finishFaceCapture}
                      onCancel={() => {
                        setPendingToken(null);
                        setFaceChallenge(null);
                        requestedTokenRef.current = null;
                        window.history.replaceState(null, "", "/attendance");
                      }}
                    />
                  ) : (
                    <div className="py-10 text-center text-sm text-slate-600">
                      <RefreshCw className="mx-auto mb-3 size-7 animate-spin text-violet-600" />
                      กำลังตรวจสอบ QR และเตรียมคำทดสอบใบหน้า...
                    </div>
                  )}
                  {completeFaceVerification.isPending && (
                    <div className="mt-3 rounded-xl bg-white p-3 text-center text-sm font-medium text-violet-700">
                      <RefreshCw className="mr-2 inline size-4 animate-spin" />
                      กำลังเปรียบเทียบใบหน้าและบันทึกเวลา...
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div
                    className={`relative overflow-hidden rounded-2xl bg-slate-950 ${
                      cameraActive ? "aspect-[4/3]" : "min-h-52"
                    }`}
                  >
                    <video
                      ref={videoRef}
                      muted
                      playsInline
                      className={`size-full object-cover ${cameraActive ? "block" : "hidden"}`}
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    {!cameraActive && (
                      <div className="absolute inset-0 grid place-items-center p-6 text-center text-white">
                        <div>
                          <Camera className="mx-auto size-12 text-cyan-300" />
                          <div className="mt-3 font-semibold">
                            ใช้กล้องหลังสแกน QR
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            ต้องเปิดผ่าน HTTPS หรือ localhost เพื่ออนุญาตกล้อง
                          </div>
                        </div>
                      </div>
                    )}
                    {cameraActive && (
                      <div className="pointer-events-none absolute inset-[12%] rounded-3xl border-2 border-cyan-300 shadow-[0_0_0_999px_rgba(2,6,23,0.35)]" />
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {cameraActive ? (
                      <Button size="lg" variant="outline" onClick={stopCamera}>
                        <X /> ปิดกล้อง
                      </Button>
                    ) : (
                      <Button size="lg" onClick={() => void startCamera()}>
                        <Camera /> เปิดกล้องสแกน QR
                      </Button>
                    )}
                    <Button size="lg" variant="outline" asChild>
                      <label className="cursor-pointer">
                        <ImageUp /> อ่าน QR จากรูป
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={event => void uploadQr(event)}
                        />
                      </label>
                    </Button>
                  </div>
                </>
              )}
              {cameraError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {cameraError}
                </div>
              )}
              {!status.isPending && !status.data?.faceProfile.enrolled && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  บัญชีนี้ยังไม่ได้ลงทะเบียนใบหน้า จึงยังลงเวลาไม่ได้
                  กรุณาติดต่อผู้จัดการสาขา
                </div>
              )}
              {openSession?.reviewStatus === "pending" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  ไม่พบกะที่ตรงกับเวลานี้
                  รายการถูกบันทึกแล้วและรอผู้จัดการตรวจสอบ
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="size-5 text-violet-600" />{" "}
                ประวัติล่าสุดของฉัน
              </CardTitle>
              <CardDescription>เวลาแสดงตามเขตเวลา Asia/Bangkok</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {status.isPending && (
                <div className="py-10 text-center text-sm text-slate-500">
                  กำลังโหลดรายการลงเวลา...
                </div>
              )}
              {status.data?.recent.map(row => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {new Date(
                          `${row.workDate}T00:00:00+07:00`
                        ).toLocaleDateString("th-TH", {
                          dateStyle: "medium",
                          timeZone: "Asia/Bangkok",
                        })}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {thaiTime(row.clockInAt)} – {thaiTime(row.clockOutAt)}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        row.status === "open"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-blue-200 bg-blue-50 text-blue-700"
                      }
                    >
                      {row.status === "open" ? "กำลังทำงาน" : "เสร็จสิ้น"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>เข้า: {methodText(row.clockInMethod)}</span>
                    <span>ออก: {methodText(row.clockOutMethod)}</span>
                    {row.workedMinutes != null && (
                      <span>
                        ทำงาน {Math.floor(row.workedMinutes / 60)} ชม.{" "}
                        {row.workedMinutes % 60} นาที
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!status.isPending && status.data?.recent.length === 0 && (
                <div className="py-10 text-center text-sm text-slate-500">
                  ยังไม่มีประวัติลงเวลา
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-violet-600" />{" "}
                พนักงานที่ลงเวลาวันนี้
              </CardTitle>
              <CardDescription>
                รายการของสาขาปัจจุบัน · รีเฟรชอัตโนมัติทุก 30 วินาที
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-3 font-semibold">พนักงาน</th>
                      <th className="px-3 py-3 font-semibold">กะ</th>
                      <th className="px-3 py-3 font-semibold">เข้า</th>
                      <th className="px-3 py-3 font-semibold">ออก</th>
                      <th className="px-3 py-3 font-semibold">สถานะ</th>
                      <th className="px-3 py-3 font-semibold">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchAttendance.data?.map(row => (
                      <tr key={row.id}>
                        <td className="px-3 py-3 font-medium text-slate-900">
                          {row.staffName}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {row.shiftName ?? "นอกตาราง"}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {thaiTime(row.clockInAt)}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {thaiTime(row.clockOutAt)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            variant="outline"
                            className={
                              row.status === "open"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                            }
                          >
                            {row.status === "open"
                              ? "กำลังทำงาน"
                              : "ออกงานแล้ว"}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {row.reviewStatus === "pending" ? (
                            <span className="font-medium text-amber-700">
                              รอตรวจสอบกะ
                            </span>
                          ) : row.lateMinutes > 0 ? (
                            `สาย ${row.lateMinutes} นาที`
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!branchAttendance.isPending &&
                branchAttendance.data?.length === 0 && (
                  <div className="py-10 text-center text-sm text-slate-500">
                    วันนี้ยังไม่มีพนักงานลงเวลา
                  </div>
                )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function FaceEnrollmentManager() {
  const { staff } = useStaff();
  const canManage = staff?.role === "admin" || staff?.role === "manager";
  const utils = trpc.useUtils();
  const profiles = trpc.attendance.faceProfileList.useQuery(undefined, {
    enabled: canManage,
  });
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const activeStaffId = selectedStaffId ?? profiles.data?.[0]?.staffId ?? null;

  useEffect(() => {
    // Prepare the models before the manager presses the capture button.
    void loadFaceEngine().catch(() => undefined);
  }, []);

  const enrollFace = trpc.attendance.enrollFace.useMutation({
    onSuccess: result => {
      setCapturing(false);
      setConsentConfirmed(false);
      void profiles.refetch();
      if (result.staffId === staff?.id)
        void utils.attendance.myStatus.invalidate();
      toast.success("ลงทะเบียนใบหน้าสำเร็จ");
    },
    onError: error => {
      setCapturing(false);
      toast.error(error.message);
    },
  });
  const deleteFace = trpc.attendance.deleteFaceProfile.useMutation({
    onSuccess: result => {
      if (result.deleted) toast.success("ลบข้อมูลใบหน้าแล้ว");
      void profiles.refetch();
      void utils.attendance.myStatus.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const finishEnrollment = useCallback(
    (result: FaceCaptureResult) => {
      if (activeStaffId == null || !consentConfirmed) return;
      enrollFace.mutate({
        staffId: activeStaffId,
        embeddings: result.embeddings,
        consentConfirmed: true,
      });
    },
    [activeStaffId, consentConfirmed, enrollFace]
  );

  if (!canManage) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>ไม่มีสิทธิ์ลงทะเบียนใบหน้าพนักงาน</CardTitle>
            <CardDescription>
              เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขาเท่านั้น
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <a href="/attendance">
                <ArrowLeft /> กลับหน้าลงเวลา
              </a>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const selected = profiles.data?.find(row => row.staffId === activeStaffId);

  return (
    <main className="min-h-screen bg-[#f6f5fb] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-violet-600">
              <ScanFace className="size-4" /> Face enrollment
            </div>
            <h1 className="mt-1 font-heading text-2xl font-bold text-slate-950 sm:text-3xl">
              ลงทะเบียนใบหน้าพนักงาน
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {staff?.branch.name} · เก็บเฉพาะข้อมูลตัวเลขที่เข้ารหัส
              ไม่เก็บรูปภาพ
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href="/attendance">
              <ArrowLeft /> กลับหน้าลงเวลา
            </a>
          </Button>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(320px,.85fr)_minmax(0,1.15fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRoundCheck className="size-5 text-violet-600" />{" "}
                เลือกพนักงาน
              </CardTitle>
              <CardDescription>
                พนักงานต้องอยู่ต่อหน้ากล้องและยินยอมก่อนลงทะเบียน
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <select
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                value={activeStaffId ?? ""}
                disabled={capturing || profiles.isPending}
                onChange={event => {
                  setSelectedStaffId(Number(event.target.value));
                  setConsentConfirmed(false);
                }}
              >
                {profiles.data?.map(row => (
                  <option key={row.staffId} value={row.staffId}>
                    {row.staffName} {row.enrolledAt ? "(ลงทะเบียนแล้ว)" : ""}
                  </option>
                ))}
              </select>
              {selected && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="font-semibold text-slate-900">
                    {selected.staffName}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    สถานะ:{" "}
                    {selected.enrolledAt ? "ลงทะเบียนแล้ว" : "ยังไม่ลงทะเบียน"}
                  </div>
                  {selected.updatedAt && (
                    <div className="mt-1 text-xs text-slate-500">
                      อัปเดต {thaiDateTime(selected.updatedAt)}
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-violet-600"
                  checked={consentConfirmed}
                  disabled={capturing}
                  onChange={event => setConsentConfirmed(event.target.checked)}
                />
                <span>
                  พนักงานได้รับคำอธิบายและยินยอมให้เก็บ Face Embedding
                  เพื่อใช้ลงเวลา โดยสามารถขอลบหรือลงทะเบียนใหม่ได้
                </span>
              </label>
              {!capturing && (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={activeStaffId == null || !consentConfirmed}
                  onClick={() => setCapturing(true)}
                >
                  <Camera /> เริ่มสแกนใบหน้า
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {capturing
                  ? `กำลังลงทะเบียน ${selected?.staffName ?? ""}`
                  : "กล้องลงทะเบียน"}
              </CardTitle>
              <CardDescription>
                ระบบจะตรวจคนจริงและเก็บตัวอย่างใบหน้า 3 ครั้ง
              </CardDescription>
            </CardHeader>
            <CardContent>
              {capturing ? (
                <FaceCapture
                  mode="enroll"
                  onComplete={finishEnrollment}
                  onCancel={() => setCapturing(false)}
                />
              ) : (
                <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 text-center">
                  <div>
                    <ScanFace className="mx-auto size-14 text-slate-400" />
                    <p className="mt-3 text-sm text-slate-600">
                      เลือกพนักงานและยืนยันความยินยอมเพื่อเปิดกล้อง
                    </p>
                  </div>
                </div>
              )}
              {enrollFace.isPending && (
                <div className="mt-3 rounded-xl bg-violet-50 p-3 text-center text-sm font-medium text-violet-700">
                  <RefreshCw className="mr-2 inline size-4 animate-spin" />
                  กำลังเข้ารหัสและบันทึกข้อมูลใบหน้า...
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>สถานะใบหน้าพนักงานในสาขา</CardTitle>
            <CardDescription>
              ลบข้อมูลได้ทันที
              เมื่อลบแล้วพนักงานจะลงเวลาไม่ได้จนกว่าจะลงทะเบียนใหม่
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {profiles.data?.map(row => (
                <div
                  key={row.staffId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <div className="font-medium text-slate-900">
                      {row.staffName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.enrolledAt
                        ? `ลงทะเบียนเมื่อ ${thaiDateTime(row.enrolledAt)}`
                        : "ยังไม่ลงทะเบียน"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        row.enrolledAt
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }
                    >
                      {row.enrolledAt ? "พร้อมใช้งาน" : "ยังไม่มีใบหน้า"}
                    </Badge>
                    {row.enrolledAt && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deleteFace.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `ยืนยันลบข้อมูลใบหน้าของ ${row.staffName} หรือไม่?`
                            )
                          ) {
                            deleteFace.mutate({ staffId: row.staffId });
                          }
                        }}
                      >
                        <Trash2 /> ลบ
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function Attendance() {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/attendance/kiosk") return <AttendanceKiosk />;
  if (path === "/attendance/enroll") return <FaceEnrollmentManager />;
  return <AttendanceSelfService />;
}
