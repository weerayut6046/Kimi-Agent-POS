import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Database,
  Droplet,
  FolderOutput,
  LogIn,
  Network,
  ShieldCheck,
  Gauge,
  Wifi,
  LockKeyhole,
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

export default function Login() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const { login } = useStaff();
  const navigate = useNavigate();
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;

  useEffect(() => {
    window.posDesktop
      ?.getDbConfig()
      .then(c => setDbPath(c.dbPath))
      .catch(() => {});
    window.posDesktop
      ?.getAppVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: s => {
      login(
        s as {
          id: number;
          name: string;
          role: "admin" | "manager" | "cashier";
          username: string;
        }
      );
      navigate("/");
    },
    onError: e => setError(e.message || "เข้าสู่ระบบไม่สำเร็จ"),
  });

  // URL สำหรับเครื่องอื่นใน LAN (แสดงเฉพาะตอนเปิด lan_enabled ใน Settings)
  const { data: lanInfo } = trpc.catalog.lanInfo.useQuery();

  // เลือกตำแหน่งไฟล์ฐานข้อมูล (desktop เท่านั้น) — สำเร็จแล้วแอปจะรีสตาร์ทเอง
  const chooseDb = async (mode: "open" | "save") => {
    setError("");
    try {
      const r = await window.posDesktop?.chooseDbPath(mode);
      if (r && r.changed === false) {
        if (r.error) setError(r.error);
        return;
      }
    } catch {
      // แอปออกระหว่างรีสตาร์ท — ถือว่าสำเร็จ
    }
    setRestarting(true);
  };

  return (
    <div className="grid min-h-screen bg-slate-100 lg:grid-cols-[minmax(420px,0.95fr)_minmax(520px,1.05fr)]">
      <section className="relative hidden overflow-hidden bg-[#091a36] p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="pointer-events-none absolute -right-24 top-16 size-96 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-black/20">
            <Droplet className="size-6 fill-white/20" />
          </div>
          <div>
            <div className="font-heading text-lg font-bold">PumpPOS</div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300/60">
              Station management
            </div>
          </div>
        </div>

        <div className="relative my-auto max-w-xl py-12">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-400">
            พร้อมสำหรับทุกกะ
          </div>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-[1.28] xl:text-5xl">
            งานหน้าปั๊ม
            <br />
            ชัดเจนในหน้าจอเดียว
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-blue-100/60">
            ขายสินค้า ตัดกะ เช็กสต๊อก และติดตามยอดได้รวดเร็ว
            ออกแบบเพื่อการทำงานต่อเนื่องของสถานีบริการ
          </p>

          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              { icon: Gauge, label: "ทำรายการเร็ว" },
              { icon: ShieldCheck, label: "ข้อมูลเป็นระบบ" },
              { icon: Wifi, label: "รองรับหลายจุด" },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-xl border border-white/10 bg-white/[0.055] p-4"
              >
                <item.icon className="size-5 text-blue-300" />
                <div className="mt-3 text-xs font-medium text-white/75">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/[0.35]">
          <span className="size-1.5 rounded-full bg-emerald-400" />{" "}
          ระบบจัดการสถานีบริการแบบครบวงจร
        </div>
      </section>

      <section className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
        <div className="pointer-events-none absolute left-1/2 top-0 h-56 w-96 -translate-x-1/2 rounded-full bg-blue-200/40 blur-3xl" />
        <Card className="relative w-full max-w-md gap-0 overflow-hidden border-slate-200 py-0 shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
          <CardHeader className="border-b border-slate-100 px-6 pb-5 pt-7 text-center sm:px-8 sm:pt-8">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-[#0b2854] text-white shadow-lg shadow-blue-950/20 lg:hidden">
              <Droplet className="size-7" />
            </div>
            <div className="mx-auto mb-3 hidden size-11 place-items-center rounded-xl bg-blue-50 text-blue-700 lg:grid">
              <LockKeyhole className="size-5" />
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
                <Input
                  id="login-username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="เช่น admin"
                  autoFocus
                  className="h-12 bg-slate-50 px-4 focus:bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="login-pin"
                  className="font-semibold text-slate-700"
                >
                  รหัส PIN
                </Label>
                <Input
                  id="login-pin"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  placeholder="••••"
                  className="h-12 bg-slate-50 px-4 text-lg tracking-[0.22em] focus:bg-white"
                />
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
                className="h-12 w-full rounded-xl text-base shadow-lg shadow-blue-600/15"
                disabled={loginMut.isPending || !username || !pin}
              >
                <LogIn className="w-4 h-4 mr-2" />
                {loginMut.isPending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
              </Button>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-center text-[11px] text-slate-400">
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

            {/* ตั้งค่าตำแหน่งฐานข้อมูล — เฉพาะ desktop app */}
            {isDesktop && (
              <div className="mt-4 border-t pt-3 space-y-2">
                <p className="text-xs text-muted-foreground break-all">
                  ฐานข้อมูล: {dbPath ?? "กำลังอ่าน..."}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => chooseDb("open")}
                  >
                    <Database className="w-3.5 h-3.5 mr-1" />{" "}
                    ใช้ไฟล์ฐานข้อมูลเดิม
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => chooseDb("save")}
                  >
                    <FolderOutput className="w-3.5 h-3.5 mr-1" />{" "}
                    สร้างไฟล์ไว้ที่อื่น
                  </Button>
                </div>
                {restarting && (
                  <p className="text-xs text-primary font-medium">
                    เปลี่ยนตำแหน่งแล้ว กำลังรีสตาร์ทแอป...
                  </p>
                )}
                {appVersion && (
                  <p className="text-xs text-muted-foreground/70 text-right">
                    เวอร์ชัน {appVersion}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
