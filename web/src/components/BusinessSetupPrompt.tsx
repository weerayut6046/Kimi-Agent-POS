import { Link } from "react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { BUSINESS_SETUP_STEPS } from "@contracts/onboarding";
import { hasMenuPermission } from "@contracts/menuPermissions";
import { useStaff } from "@/hooks/useStaff";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";

export default function BusinessSetupPrompt() {
  const { staff } = useStaff();
  const canSetUp = Boolean(
    staff?.role === "admin" &&
    hasMenuPermission(staff.role, staff.menuPermissions, "setup")
  );
  const setup = trpc.onboarding.state.useQuery(undefined, {
    enabled: canSetUp,
    staleTime: 60_000,
    retry: false,
  });
  if (!canSetUp || !setup.data || setup.data.progress.completedAt) return null;
  const done = BUSINESS_SETUP_STEPS.filter(
    step => setup.data.progress.confirmed[step]
  ).length;

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between"
      aria-label="เริ่มต้นใช้งานกิจการ"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 className="font-heading text-lg font-semibold">
            เตรียมกิจการให้พร้อมเริ่มขาย
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ตั้งข้อมูลสาขา สินค้า ผู้ใช้งาน และช่องทางรับเงินจากหน้าเดียว
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            บันทึกและตรวจแล้ว {done} จาก 4 ขั้น · กลับมาทำต่อได้
          </p>
        </div>
      </div>
      <Button asChild className="shrink-0">
        <Link to="/setup">
          {done ? "ตั้งค่าต่อ" : "เริ่มตั้งค่า"}
          <ArrowRight className="ml-2 size-4" />
        </Link>
      </Button>
    </section>
  );
}
