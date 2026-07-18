import { useState } from "react";
import { useNavigate } from "react-router";
import { Droplet, LogIn } from "lucide-react";
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
  const { login } = useStaff();
  const navigate = useNavigate();

  const loginMut = trpc.auth.login.useMutation({
    onSuccess: (s) => {
      login(s as { id: number; name: string; role: "admin" | "manager" | "cashier"; username: string });
      navigate("/");
    },
    onError: (e) => setError(e.message || "เข้าสู่ระบบไม่สำเร็จ"),
  });

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
        </CardContent>
      </Card>
    </div>
  );
}
