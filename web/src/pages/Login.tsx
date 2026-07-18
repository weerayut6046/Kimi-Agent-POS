import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Database, Droplet, FolderOutput, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { useStaff } from "@/hooks/useStaff";

export default function Login() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const { login } = useStaff();
  const navigate = useNavigate();
  const isDesktop = typeof window !== "undefined" && !!window.posDesktop;

  useEffect(() => {
    window.posDesktop?.getDbConfig().then((c) => setDbPath(c.dbPath)).catch(() => {});
  }, []);

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: (s) => {
      login(s as { id: number; name: string; role: "admin" | "manager" | "cashier"; username: string });
      navigate("/");
    },
    onError: (e) => setError(e.message || "เข้าสู่ระบบไม่สำเร็จ"),
  });

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary via-blue-600 to-sky-500 p-4">
      <Card className="w-full max-w-sm shadow-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto bg-primary text-primary-foreground rounded-2xl w-14 h-14 flex items-center justify-center mb-2">
            <Droplet className="w-7 h-7" />
          </div>
          <CardTitle className="font-heading text-2xl">PumpPOS</CardTitle>
          <CardDescription>ระบบปั๊มน้ำมันครบวงจร — เข้าสู่ระบบพนักงาน</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              loginMut.mutate({ username, pin });
            }}
          >
            <div className="space-y-1.5">
              <Label>ชื่อผู้ใช้</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>รหัส PIN</Label>
              <Input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loginMut.isPending || !username || !pin}>
              <LogIn className="w-4 h-4 mr-2" />
              {loginMut.isPending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              ทดลองใช้: admin / 1234 (ผู้ดูแล) หรือ somchai / 0000 (พนักงาน)
            </p>
          </form>

          {/* ตั้งค่าตำแหน่งฐานข้อมูล — เฉพาะ desktop app */}
          {isDesktop && (
            <div className="mt-4 border-t pt-3 space-y-2">
              <p className="text-xs text-muted-foreground break-all">
                ฐานข้อมูล: {dbPath ?? "กำลังอ่าน..."}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" className="flex-1 text-xs" onClick={() => chooseDb("open")}>
                  <Database className="w-3.5 h-3.5 mr-1" /> ใช้ไฟล์ฐานข้อมูลเดิม
                </Button>
                <Button type="button" variant="outline" size="sm" className="flex-1 text-xs" onClick={() => chooseDb("save")}>
                  <FolderOutput className="w-3.5 h-3.5 mr-1" /> สร้างไฟล์ไว้ที่อื่น
                </Button>
              </div>
              {restarting && <p className="text-xs text-primary font-medium">เปลี่ยนตำแหน่งแล้ว กำลังรีสตาร์ทแอป...</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
