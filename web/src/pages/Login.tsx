import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Droplet,
  LogIn,
  Network,
  ShieldCheck,
  Gauge,
  Wifi,
  UserRound,
  KeyRound,
  Eye,
  EyeOff,
  Activity,
  Sparkles,
  Fingerprint,
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
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";
import { getFirstAllowedMenuPath } from "@contracts/menuPermissions";

export default function Login() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const { login } = useStaff();
  const navigate = useNavigate();
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;

  useEffect(() => {
    window.posDesktop
      ?.getAppVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: async s => {
      await login(s);
      navigate(getFirstAllowedMenuPath(s.role, s.menuPermissions) ?? "/");
    },
    onError: e => setError(e.message || "เข้าสู่ระบบไม่สำเร็จ"),
  });

  // URL สำหรับเครื่องอื่นใน LAN (แสดงเฉพาะตอนเปิด lan_enabled ใน Settings)
  const { data: lanInfo } = trpc.catalog.lanInfo.useQuery();

  return (
    <div className="grid min-h-screen bg-[#f6f5fb] lg:grid-cols-[minmax(440px,1.04fr)_minmax(520px,0.96fr)]">
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
        <Card className="aurora-border glass-panel relative z-0 w-full max-w-md gap-0 overflow-hidden rounded-[30px] border-0 py-0 ring-1 ring-white/70">
          <CardHeader className="border-b border-slate-100/80 px-6 pb-5 pt-7 text-center sm:px-8 sm:pt-8">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-500/25 lg:hidden">
              <Droplet className="size-7" />
            </div>
            <div className="mx-auto mb-4 hidden size-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-cyan-50 text-violet-700 shadow-inner ring-1 ring-violet-100 lg:grid">
              <Fingerprint className="size-6" />
            </div>
            <CardTitle className="font-heading text-2xl font-bold text-slate-900">
              เข้าสู่ระบบพนักงาน
            </CardTitle>
            <CardDescription className="mt-1">
              กรอกชื่อผู้ใช้และ PIN เพื่อเริ่มกะการทำงาน
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-6 sm:px-8">
            <form
              className="space-y-5"
              onSubmit={e => {
                e.preventDefault();
                setError("");
                loginMut.mutate({ username, pin });
              }}
            >
              <div className="space-y-2">
                <Label
                  htmlFor="login-username"
                  className="font-semibold text-slate-700"
                >
                  ชื่อผู้ใช้
                </Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="เช่น admin"
                    autoFocus
                    autoComplete="username"
                    className="h-12 bg-slate-50/80 pl-11 pr-4 focus:bg-white"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="login-pin"
                  className="font-semibold text-slate-700"
                >
                  รหัส PIN
                </Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-pin"
                    type={showPin ? "text" : "password"}
                    inputMode="text"
                    value={pin}
                    onChange={e => setPin(e.target.value)}
                    placeholder="••••"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-12 bg-slate-50/80 pl-11 pr-12 text-lg tracking-[0.22em] focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(show => !show)}
                    aria-label={showPin ? "ซ่อนรหัส PIN" : "แสดงรหัส PIN"}
                    aria-pressed={showPin}
                    className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
                  >
                    {showPin ? (
                      <EyeOff className="size-[18px]" />
                    ) : (
                      <Eye className="size-[18px]" />
                    )}
                  </button>
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
                className="shine-button h-12 w-full rounded-2xl text-base shadow-lg shadow-violet-600/25"
                disabled={loginMut.isPending || !username || !pin}
              >
                <LogIn className="w-4 h-4 mr-2" />
                {loginMut.isPending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </Button>
              <div className="rounded-xl bg-gradient-to-r from-violet-50/80 to-cyan-50/80 px-3 py-2.5 text-center text-[11px] text-slate-400 ring-1 ring-violet-100/60">
                ทดลองใช้{" "}
                <span className="font-mono font-semibold text-slate-600">
                  admin / 1234
                </span>{" "}
                หรือ{" "}
                <span className="font-mono font-semibold text-slate-600">
                  somchai / 0000
                </span>
              </div>
            </form>

            {/* URL สำหรับเครื่องอื่นใน LAN — แสดงเมื่อเปิดใช้ multi-station ใน Settings */}
            {lanInfo?.enabled && lanInfo.urls.length > 0 && (
              <div className="mt-4 border-t pt-3 space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Network className="w-3.5 h-3.5" /> เครื่องอื่นในร้านเปิดที่:
                </p>
                {lanInfo.urls.map(u => (
                  <p key={u} className="text-xs font-mono text-primary">
                    {u}
                  </p>
                ))}
              </div>
            )}

            {isDesktop && appVersion && (
              <p className="mt-4 border-t pt-3 text-right text-xs text-muted-foreground/70">
                เวอร์ชัน {appVersion} · ฐานข้อมูล Supabase
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
