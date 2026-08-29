import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  Download,
  LoaderCircle,
  Printer,
  QrCode,
  ScanLine,
  Smartphone,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { printElement } from "@/lib/printDoc";

type CustomerLoyaltyQrDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  shopName: string;
};

export function CustomerLoyaltyQrDialog({
  open,
  onOpenChange,
  url,
  shopName,
}: CustomerLoyaltyQrDialogProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [qrCode, setQrCode] = useState<{ source: string; dataUrl: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    void QRCode.toDataURL(url, {
      width: 720,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#0f172a", light: "#ffffff" },
    }).then(value => {
      if (!cancelled) setQrCode({ source: url, dataUrl: value });
    });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  const qrDataUrl = open && qrCode?.source === url ? qrCode.dataUrl : "";

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-violet-600" /> QR ตรวจสอบแต้มสมาชิก
          </DialogTitle>
          <DialogDescription>
            วาง QR นี้ที่จุดชำระเงิน ลูกค้าสแกนแล้วกรอกเบอร์โทรเพื่อดูแต้มและประวัติได้ทันที
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-2xl bg-slate-100 p-4">
          <div
            ref={printRef}
            id="customer-loyalty-qr-print"
            className="relative mx-auto min-h-[176mm] w-[124mm] overflow-hidden rounded-[7mm] bg-gradient-to-b from-slate-950 via-blue-950 to-blue-800 p-[9mm] text-center text-white shadow-2xl"
          >
            <div className="surface-grid pointer-events-none absolute inset-0 opacity-60" />
            <div className="pointer-events-none absolute -right-[22mm] -top-[25mm] size-[70mm] rounded-full border border-cyan-200/15" />
            <div className="pointer-events-none absolute -bottom-[25mm] -left-[22mm] size-[70mm] rounded-full bg-violet-400/20 blur-[8mm]" />
            <div className="relative">
              <div className="mx-auto grid size-[17mm] place-items-center rounded-[5mm] border border-white/15 bg-white/10">
                <Star className="size-[9mm] fill-cyan-300 text-cyan-300" />
              </div>
              <p className="mt-[4mm] truncate text-[4.4mm] font-black">
                {shopName}
              </p>
              <p className="mt-[1mm] text-[2.6mm] font-bold uppercase tracking-[1mm] text-cyan-200">
                MEMBER CLUB
              </p>

              <h2 className="mt-[7mm] text-[8mm] font-black leading-tight">
                สแกนเช็กแต้ม
                <br />
                สะสมของคุณ
              </h2>
              <p className="mt-[3mm] text-[3.2mm] leading-relaxed text-blue-100">
                ดูแต้มคงเหลือ พร้อมประวัติการรับและใช้แต้ม
              </p>

              <div className="mx-auto mt-[7mm] grid size-[67mm] place-items-center rounded-[7mm] bg-white p-[4mm] shadow-2xl">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR สำหรับตรวจสอบแต้มสมาชิก"
                    className="size-full"
                  />
                ) : (
                  <LoaderCircle className="size-[14mm] animate-spin text-violet-500" />
                )}
              </div>

              <div className="mx-auto mt-[6mm] grid max-w-[92mm] grid-cols-3 gap-[3mm] text-[2.6mm] font-semibold leading-snug text-blue-50">
                <div>
                  <div className="mx-auto mb-[1.5mm] grid size-[8mm] place-items-center rounded-full bg-white/10">
                    <ScanLine className="size-[4mm]" />
                  </div>
                  1. สแกน QR
                </div>
                <div>
                  <div className="mx-auto mb-[1.5mm] grid size-[8mm] place-items-center rounded-full bg-white/10">
                    <Smartphone className="size-[4mm]" />
                  </div>
                  2. กรอกเบอร์
                </div>
                <div>
                  <div className="mx-auto mb-[1.5mm] grid size-[8mm] place-items-center rounded-full bg-white/10">
                    <Star className="size-[4mm]" />
                  </div>
                  3. ดูแต้ม
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="min-w-0 flex-1 truncate font-mono">{url}</span>
          <Button type="button" size="sm" variant="ghost" onClick={copyUrl}>
            {copied ? (
              <Check className="mr-1.5 size-3.5 text-emerald-600" />
            ) : (
              <Copy className="mr-1.5 size-3.5" />
            )}
            {copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </Button>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={!qrDataUrl}
              onClick={() => {
                const link = document.createElement("a");
                link.href = qrDataUrl;
                link.download = "member-points-qr.png";
                link.click();
              }}
            >
              <Download className="mr-2 size-4" /> ดาวน์โหลด QR
            </Button>
            <Button
              type="button"
              disabled={!qrDataUrl}
              onClick={() => {
                if (printRef.current) {
                  printElement(
                    printRef.current,
                    "size: A5 portrait; margin: 12mm",
                    "#customer-loyalty-qr-print{width:124mm!important;min-height:176mm!important;margin:0 auto!important;box-shadow:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}#customer-loyalty-qr-print *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}"
                  );
                }
              }}
            >
              <Printer className="mr-2 size-4" /> พิมพ์ป้าย A5
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
