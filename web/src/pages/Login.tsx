import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Delete as DeleteIcon,
  Droplet,
  KeyRound,
  LogIn,
  ShieldCheck,
  Gauge,
  Wifi,
  Activity,
  Sparkles,
  Fingerprint,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ScanFace,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FaceCapture,
  type FaceCaptureResult,
  type FaceLivenessAction,
} from "@/components/FaceCapture";
import { trpc } from "@/providers/trpc";
import { useStaff, type StaffLoginResult } from "@/hooks/useStaff";
import {
  clearSupabaseSession,
  installSupabaseSession,
  signInStaffWithPassword,
} from "@/lib/supabase";
import { isLocalAuthEnabled } from "@/lib/localAuth";
import { attendanceTokenFromPayload } from "@/lib/attendanceQr";
import { loadFaceEngine } from "@/lib/faceRecognition";

type LoginFaceChallenge = {
  token: string;
  expiresAt: Date;
  livenessAction: FaceLivenessAction;
  attendanceAction: "clock_in" | "clock_out";
  staffName: string;
};

function attendanceTokenForLogin(): string | null {
  const direct = attendanceTokenFromPayload(window.location.href);
  if (direct) return direct;
  const returnTo = window.sessionStorage.getItem("pos:return-to");
  return returnTo ? attendanceTokenFromPayload(returnTo) : null;
}

function destinationAfterLogin(): string {
  const returnTo = window.sessionStorage.getItem("pos:return-to");
  if (
    !returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo === "/login" ||
    attendanceTokenFromPayload(returnTo)
  ) {
    return "/";
  }
  return returnTo;
}

function preloadAuthenticatedApp(): void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (supabaseUrl && !document.querySelector(`link[href="${supabaseUrl}"]`)) {
    const connectionHint = document.createElement("link");
    connectionHint.rel = "preconnect";
    connectionHint.href = supabaseUrl;
    connectionHint.crossOrigin = "anonymous";
    document.head.append(connectionHint);
  }

  if (!import.meta.env.PROD) return;
  void Promise.all([
    import("@/AuthenticatedApp"),
    import("@/components/Layout"),
    import("@/pages/Dashboard"),
  ]);
}

export default function Login() {
  const [pin, setPin] = useState("");
  const [adminRecovery, setAdminRecovery] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [qrToken] = useState(attendanceTokenForLogin);
  const [faceChallenge, setFaceChallenge] = useState<LoginFaceChallenge | null>(
    null
  );
  const [faceCaptureKey, setFaceCaptureKey] = useState(0);
  const { login } = useStaff();
  const utils = trpc.useUtils();
  const beginPinFaceLogin = trpc.attendance.beginPinFaceLogin.useMutation();
  const completePinFaceLogin =
    trpc.attendance.completePinFaceLogin.useMutation();
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;

  useEffect(() => {
    window.posDesktop
      ?.getAppVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (qrToken) void loadFaceEngine().catch(() => undefined);
  }, [qrToken]);

  const completeLogin = async (staff: StaffLoginResult) => {
    const destination = destinationAfterLogin();
    window.sessionStorage.removeItem("pos:return-to");
    window.history.replaceState(null, "", destination);
    await login(staff);
  };

  const submitPin = async () => {
    if (!qrToken) {
      setError("กรุณาสแกน QR ประจำสาขาด้วยโทรศัพท์ก่อนกรอก PIN");
      return;
    }
    if (pin.length < 4) {
      setError("กรุณากรอก PIN อย่างน้อย 4 หลัก");
      return;
    }
    setError("");
    setIsSubmitting(true);
    preloadAuthenticatedApp();
    try {
      const challenge = await beginPinFaceLogin.mutateAsync({
        qrToken,
        pin,
      });
      setPin("");
      setFaceChallenge(challenge);
    } catch (loginError) {
      setPin("");
      setError(
        loginError instanceof Error
          ? loginError.message
          : "เข้าสู่ระบบไม่สำเร็จ"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const finishFaceLogin = async (result: FaceCaptureResult) => {
    if (!faceChallenge) return;
    setError("");
    try {
      const verified = await completePinFaceLogin.mutateAsync({
        challengeToken: faceChallenge.token,
        embedding: result.embeddings[0]!,
        quality: result.quality,
      });
      if (verified.action !== "clock_in") {
        throw new Error("ระบบไม่สามารถยืนยันเวลาเข้างานสำหรับการล็อกอินนี้ได้");
      }
      if (verified.authSession) {
        const installed = await installSupabaseSession(verified.authSession);
        if (!installed) {
          throw new Error("สร้างเซสชันเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่");
        }
      }
      await completeLogin(verified.staff);
    } catch (faceError) {
      setError(
        faceError instanceof Error
          ? faceError.message
          : "ยืนยันใบหน้าไม่สำเร็จ กรุณาลองใหม่"
      );
      setFaceCaptureKey(value => value + 1);
    }
  };

  const cancelFaceLogin = () => {
    setFaceChallenge(null);
    setPin("");
    setError("ยกเลิกการสแกนใบหน้า กรุณากรอก PIN ใหม่");
  };

  const submitAdminRecovery = async () => {
    if (!adminUsername.trim() || !adminPassword) return;
    setError("");
    setIsSubmitting(true);
    preloadAuthenticatedApp();
    try {
      if (isLocalAuthEnabled) {
        throw new Error(
          "โหมด Local ให้ตั้ง PIN และข้อมูลใบหน้าสำหรับบัญชีผู้ดูแลก่อน"
        );
      }
      await signInStaffWithPassword(adminUsername, adminPassword);
      const staff = await utils.auth.currentStaff.fetch();
      if (staff.role !== "admin" && staff.role !== "manager") {
        await clearSupabaseSession();
        throw new Error("ทางเข้านี้ใช้ได้เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขา");
      }
      await completeLogin(staff);
    } catch (adminError) {
      await clearSupabaseSession();
      setError(
        adminError instanceof Error
          ? adminError.message
          : "เข้าสู่ระบบผู้ดูแลไม่สำเร็จ"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const pressDigit = (digit: string) => {
    if (!qrToken || isSubmitting || pin.length >= 6) return;
    setError("");
    setPin(current => `${current}${digit}`);
  };

  useEffect(() => {
    if (faceChallenge || adminRecovery) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        pressDigit(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        setPin(current => current.slice(0, -1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        void submitPin();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <main className="grid min-h-screen bg-[#f6f5fb] lg:grid-cols-[minmax(440px,1.04fr)_minmax(520px,0.96fr)]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#101028] via-[#211b58] to-[#104453] p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="surface-grid pointer-events-none absolute inset-0 opacity-75" />
        <div className="ambient-float pointer-events-none absolute -right-24 top-16 size-96 rounded-full bg-violet-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 via-violet-500 to-indigo-700 shadow-[0_14px_32px_rgba(94,67,228,0.38)] ring-1 ring-white/25">
            <Droplet className="size-6 fill-white/20" />
          </div>
          <div>
            <div className="font-heading text-lg font-bold">PumpPOS</div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.19em] text-cyan-200/60">
              <Sparkles className="size-3" /> Smart station OS
            </div>
          </div>
        </div>

        <div className="relative my-auto max-w-xl py-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">
            <span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_0_4px_rgba(103,232,249,0.12)]" />
            Next generation POS
          </div>
          <h1 className="mt-5 font-heading text-4xl font-bold leading-[1.23] tracking-[-0.04em] xl:text-5xl">
            งานหน้าปั๊ม
            <br />
            <span className="bg-gradient-to-r from-white via-violet-100 to-cyan-300 bg-clip-text text-transparent">
              คุมทุกจังหวะในหน้าจอเดียว
            </span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-white/55">
            ขายสินค้า ตัดกะ เช็กสต๊อก และติดตามยอดได้รวดเร็ว
            ออกแบบเพื่อการทำงานต่อเนื่องของสถานีบริการ
          </p>

          <div className="mt-9 grid max-w-lg grid-cols-3 gap-3">
            {[
              { icon: Gauge, label: "ทำรายการเร็ว" },
              { icon: ShieldCheck, label: "ข้อมูลเป็นระบบ" },
              { icon: Wifi, label: "รองรับหลายจุด" },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/[0.065] p-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/10"
              >
                <item.icon className="size-5 text-cyan-300" />
                <div className="mt-3 text-xs font-medium text-white/75">
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 max-w-lg rounded-[22px] border border-white/10 bg-[#090820]/40 p-4 shadow-2xl shadow-black/15 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
                <Activity className="size-4 text-cyan-300" /> สถานะการทำงาน
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative size-1.5 rounded-full bg-emerald-400" />
                </span>
                พร้อมใช้งาน
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "งานขาย", value: "รวดเร็ว", width: "88%" },
                { label: "สต๊อก", value: "แม่นยำ", width: "76%" },
                { label: "รายงาน", value: "ครบถ้วน", width: "94%" },
              ].map(item => (
                <div
                  key={item.label}
                  className="rounded-xl bg-white/[0.055] p-3"
                >
                  <div className="text-[10px] text-white/40">{item.label}</div>
                  <div className="mt-1 text-xs font-semibold text-white/80">
                    {item.value}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300"
                      style={{ width: item.width }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/[0.35]">
          <span className="size-1.5 rounded-full bg-emerald-400" />{" "}
          ระบบจัดการสถานีบริการแบบครบวงจร
        </div>
      </section>

      <section className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
        <div className="surface-dots pointer-events-none absolute inset-0 opacity-35" />
        <div className="ambient-float pointer-events-none absolute -right-24 top-12 size-80 rounded-full bg-cyan-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-8 size-96 rounded-full bg-violet-200/50 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.9),transparent_58%)]" />
        <div className="floating-chip absolute left-[8%] top-[16%] hidden items-center gap-2 rounded-2xl border border-white/80 bg-white/75 px-3 py-2 text-xs font-semibold text-violet-700 ring-1 ring-violet-100 backdrop-blur-xl xl:flex">
          <Sparkles className="size-4" /> ทำงานได้เร็วขึ้น
        </div>
        <div className="floating-chip absolute bottom-[15%] right-[7%] hidden items-center gap-2 rounded-2xl border border-white/80 bg-white/75 px-3 py-2 text-xs font-semibold text-cyan-700 ring-1 ring-cyan-100 backdrop-blur-xl [animation-delay:-2.5s] xl:flex">
          <ShieldCheck className="size-4" /> ข้อมูลปลอดภัย
        </div>
        <Card
          className={`aurora-border glass-panel relative z-0 w-full gap-0 overflow-hidden rounded-[30px] border-0 py-0 ring-1 ring-white/70 ${
            faceChallenge ? "max-w-xl" : "max-w-md"
          }`}
        >
          <CardHeader className="border-b border-slate-100/80 px-6 pb-5 pt-7 text-center sm:px-8 sm:pt-8">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-500/25 lg:hidden">
              <Droplet className="size-7" />
            </div>
            <div className="mx-auto mb-4 hidden size-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-cyan-50 text-violet-700 shadow-inner ring-1 ring-violet-100 lg:grid">
              <Fingerprint className="size-6" />
            </div>
            <CardTitle className="font-heading text-2xl font-bold text-slate-900">
              {faceChallenge
                ? "สแกนใบหน้าเข้างาน"
                : adminRecovery
                  ? "เข้าสู่ระบบผู้ดูแล"
                  : "กรอกรหัส PIN"}
            </CardTitle>
            <CardDescription className="mt-1">
              {faceChallenge
                ? `${faceChallenge.staffName} · ยืนยันตัวตนเพื่อเข้าระบบ`
                : adminRecovery
                  ? "สำหรับออก QR และตั้งค่า PIN/ใบหน้าพนักงาน"
                  : "กดตัวเลข 0–9 แล้วสแกนใบหน้าเพื่อเข้าสู่ระบบ"}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-6 sm:px-8">
            {faceChallenge ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-900">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  <div>
                    <div className="text-sm font-bold">PIN และ QR ถูกต้อง</div>
                    <div className="mt-0.5 text-xs text-emerald-700">
                      สแกนใบหน้าให้สำเร็จเพื่อบันทึกเข้างานและเข้าสู่ระบบ
                    </div>
                  </div>
                </div>
                <FaceCapture
                  key={faceCaptureKey}
                  mode="verify"
                  action={faceChallenge.livenessAction}
                  onComplete={finishFaceLogin}
                  onCancel={cancelFaceLogin}
                />
                {completePinFaceLogin.isPending && (
                  <div className="rounded-xl bg-violet-50 p-3 text-center text-sm font-semibold text-violet-700">
                    <RefreshCw className="mr-2 inline size-4 animate-spin" />
                    กำลังเปรียบเทียบใบหน้าและบันทึกเวลาเข้างาน...
                  </div>
                )}
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={completePinFaceLogin.isPending}
                  onClick={cancelFaceLogin}
                >
                  <ArrowLeft /> กลับไปกรอก PIN ใหม่
                </Button>
              </div>
            ) : adminRecovery ? (
              <form
                className="space-y-5"
                onSubmit={event => {
                  event.preventDefault();
                  void submitAdminRecovery();
                }}
              >
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3.5 text-sm leading-6 text-blue-900">
                  ทางเข้านี้ใช้เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขา
                  เพื่อออก QR และเตรียมบัญชีพนักงานเท่านั้น
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-username">ชื่อผู้ใช้ผู้ดูแล</Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
                    <Input
                      id="admin-username"
                      autoFocus
                      autoComplete="username"
                      value={adminUsername}
                      onChange={event => setAdminUsername(event.target.value)}
                      className="h-12 bg-slate-50/80 pl-11"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">รหัสผ่านผู้ดูแล</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
                    <Input
                      id="admin-password"
                      type="password"
                      autoComplete="current-password"
                      value={adminPassword}
                      onChange={event => setAdminPassword(event.target.value)}
                      className="h-12 bg-slate-50/80 pl-11"
                    />
                  </div>
                </div>
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="shine-button h-12 w-full rounded-2xl text-base"
                  disabled={
                    isSubmitting ||
                    !adminUsername.trim() ||
                    !adminPassword
                  }
                >
                  {isSubmitting ? (
                    <RefreshCw className="mr-2 size-4 animate-spin" />
                  ) : (
                    <LogIn className="mr-2 size-4" />
                  )}
                  {isSubmitting ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบผู้ดูแล"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={isSubmitting}
                  onClick={() => {
                    setAdminRecovery(false);
                    setAdminPassword("");
                    setError("");
                  }}
                >
                  <ArrowLeft /> กลับไปหน้า PIN พนักงาน
                </Button>
              </form>
            ) : (
              <form
                className="space-y-5"
                onSubmit={e => {
                  e.preventDefault();
                  void submitPin();
                }}
              >
                <div
                  className={`flex items-start gap-3 rounded-2xl border p-3.5 ${
                    qrToken
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-950"
                  }`}
                >
                  {qrToken ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                  ) : (
                    <QrCode className="mt-0.5 size-5 shrink-0 text-amber-700" />
                  )}
                  <div>
                    <div className="text-sm font-bold">
                      {qrToken
                        ? "สแกน QR ประจำสาขาแล้ว"
                        : "พนักงานประจำกะให้สแกน QR ก่อน"}
                    </div>
                    <div className="mt-0.5 text-xs leading-5 opacity-80">
                      {qrToken
                        ? "กด PIN ของพนักงาน แล้วระบบจะเปิดกล้องสแกนใบหน้า"
                        : "ใช้กล้องโทรศัพท์สแกน QR ที่สาขา แล้วลิงก์จะเปิดหน้านี้"}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="flex items-center justify-center gap-2">
                    <LockKeyhole className="mr-1 size-5 text-violet-600" />
                    {Array.from({ length: 6 }, (_, index) => (
                      <span
                        key={index}
                        className={`size-3 rounded-full border transition-all ${
                          index < pin.length
                            ? "scale-110 border-violet-600 bg-violet-600 shadow-sm shadow-violet-300"
                            : "border-slate-300 bg-white"
                        }`}
                      />
                    ))}
                  </div>
                  <div className="mt-2 text-center text-xs text-slate-500">
                    PIN 4–6 หลัก
                  </div>
                </div>
                <div
                  className="grid grid-cols-3 gap-2.5"
                  aria-label="แป้นกด PIN"
                >
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digit => (
                    <button
                      key={digit}
                      type="button"
                      disabled={!qrToken || isSubmitting}
                      onClick={() => pressDigit(digit)}
                      className="h-14 rounded-2xl border border-slate-200 bg-white text-xl font-bold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`เลข ${digit}`}
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!qrToken || isSubmitting || pin.length === 0}
                    onClick={() => setPin("")}
                    className="h-14 rounded-2xl border border-slate-200 bg-slate-100 text-sm font-bold text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ล้าง
                  </button>
                  <button
                    type="button"
                    disabled={!qrToken || isSubmitting}
                    onClick={() => pressDigit("0")}
                    className="h-14 rounded-2xl border border-slate-200 bg-white text-xl font-bold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-50 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="เลข 0"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    disabled={!qrToken || isSubmitting || pin.length === 0}
                    onClick={() => setPin(current => current.slice(0, -1))}
                    className="grid h-14 place-items-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="ลบตัวเลขล่าสุด"
                  >
                    <DeleteIcon className="size-5" />
                  </button>
                </div>
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                  >
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  className="shine-button h-12 w-full rounded-2xl text-base shadow-lg shadow-violet-600/25"
                  disabled={isSubmitting || !qrToken || pin.length < 4}
                >
                  {isSubmitting ? (
                    <RefreshCw className="mr-2 size-4 animate-spin" />
                  ) : (
                    <ScanFace className="mr-2 size-4" />
                  )}
                  {isSubmitting
                    ? "กำลังตรวจสอบ PIN..."
                    : "ยืนยัน PIN และสแกนหน้า"}
                </Button>
                {!qrToken && !isLocalAuthEnabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-slate-600"
                    onClick={() => {
                      setAdminRecovery(true);
                      setError("");
                    }}
                  >
                    <ShieldCheck /> สำหรับผู้ดูแลระบบ / ผู้จัดการ
                  </Button>
                )}
              </form>
            )}

            {isDesktop && appVersion && (
              <p className="mt-4 border-t pt-3 text-right text-xs text-muted-foreground/70">
                เวอร์ชัน {appVersion} · ฐานข้อมูล{" "}
                {isLocalAuthEnabled ? "Local PostgreSQL" : "Supabase"}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
