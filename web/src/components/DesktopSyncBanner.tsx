import { CloudUpload, Download, RefreshCw, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDesktopSync } from "@/hooks/useDesktopSync";

export function DesktopSyncBanner() {
  const { status, retry, exportRecovery } = useDesktopSync();
  if (!status || (status.online && status.pendingCount === 0)) return null;

  const offline = !status.online;
  return (
    <div
      role="status"
      className={`border-b px-3 py-2 sm:px-5 lg:px-7 ${
        offline
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-blue-200 bg-blue-50 text-blue-900"
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1540px] items-center gap-2 text-sm">
        {offline ? (
          <WifiOff className="size-4 shrink-0" />
        ) : (
          <CloudUpload className="size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <span className="font-semibold">
            {offline ? "โหมดออฟไลน์" : "กำลังส่งข้อมูลขึ้นคลาวด์"}
          </span>
          <span className="ml-1.5">
            {status.pendingCount > 0
              ? `มี ${status.pendingCount} บิลรอซิงก์`
              : "ขายได้ตามปกติ ข้อมูลจะซิงก์เมื่ออินเทอร์เน็ตกลับมา"}
          </span>
          {offline && status.pendingCount > 0 && (
            <span className="ml-1.5 hidden sm:inline">
              — บิลถูกเก็บไว้อย่างปลอดภัยในเครื่องนี้
            </span>
          )}
        </div>
        {status.pendingCount > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={status.syncing}
            onClick={() =>
              void exportRecovery()
                .then(result => {
                  if (result && !result.canceled) {
                    toast.success("บันทึกไฟล์กู้ภัยแบบเข้ารหัสแล้ว", {
                      description: result.fileName ?? undefined,
                    });
                  }
                })
                .catch(error =>
                  toast.error("ส่งออกไฟล์กู้ภัยไม่สำเร็จ", {
                    description:
                      error instanceof Error ? error.message : String(error),
                  })
                )
            }
            className="hidden h-8 shrink-0 border-current bg-white/60 sm:inline-flex"
          >
            <Download className="mr-1.5 size-3.5" />
            ไฟล์กู้ภัย
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status.syncing}
          onClick={() => void retry()}
          className="h-8 shrink-0 border-current bg-white/60"
        >
          <RefreshCw
            className={`mr-1.5 size-3.5 ${status.syncing ? "animate-spin" : ""}`}
          />
          {status.syncing ? "กำลังซิงก์" : "ลองใหม่"}
        </Button>
      </div>
    </div>
  );
}
