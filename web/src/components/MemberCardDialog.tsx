import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { CreditCard, Printer, ScanLine, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtDateTH, tierLabel } from "@/lib/format";
import { printMemberCardElement } from "@/lib/printDoc";
import { formatMemberCode, normalizeMemberCode } from "@contracts/memberCode";
import { isMemberCardExpired } from "@contracts/memberExpiry";
import type { Member } from "@db/schema";

type MemberCardDialogProps = {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settingMap?: Record<string, string>;
  logoUrl?: string | null;
};

/** Both machine-readable symbols intentionally contain the plain member code. */
function memberCardPayload(memberCode: string) {
  return normalizeMemberCode(memberCode);
}

export function MemberCardDialog({
  member,
  open,
  onOpenChange,
  settingMap,
  logoUrl,
}: MemberCardDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [qrCode, setQrCode] = useState<{ memberCode: string; url: string } | null>(
    null
  );

  const memberCode = member ? memberCardPayload(member.memberCode) : "";

  useEffect(() => {
    if (!open || !memberCode) return;

    let cancelled = false;
    void QRCode.toDataURL(memberCode, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "H",
      color: { dark: "#111827", light: "#ffffff" },
    }).then(url => {
      if (!cancelled) setQrCode({ memberCode, url });
    });

    return () => {
      cancelled = true;
    };
  }, [memberCode, open]);

  const qrDataUrl =
    open && qrCode?.memberCode === memberCode ? qrCode.url : "";

  useEffect(() => {
    if (!open || !memberCode || !barcodeRef.current) return;
    JsBarcode(barcodeRef.current, memberCode, {
      format: "CODE128",
      width: 1.7,
      height: 34,
      margin: 0,
      displayValue: false,
      background: "#ffffff",
      lineColor: "#111827",
    });
  }, [memberCode, open]);

  if (!member) return null;

  const shopName = settingMap?.shop_name?.trim() || "MEMBER CLUB";
  const cardExpired = isMemberCardExpired(member.cardExpiresAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="size-5 text-violet-600" />
            บัตรสมาชิก PVC
          </DialogTitle>
          <DialogDescription>
            ตัวอย่างขนาดจริง 85.6 × 54 มม. บาร์โค้ดและ QR ใช้รหัสสมาชิกเดียวกัน
            และมีอายุ 1 ปีนับจากวันเปิดใช้งาน
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto rounded-2xl bg-slate-100 p-4">
          <div
            ref={cardRef}
            id="member-card-print"
            className="relative mx-auto shrink-0 overflow-hidden rounded-[3mm] text-white shadow-2xl"
            style={{
              width: "85.6mm",
              height: "54mm",
              background:
                "linear-gradient(135deg, #111827 0%, #312e81 48%, #6d28d9 100%)",
            }}
            aria-label={`บัตรสมาชิก ${member.name} รหัส ${memberCode}`}
          >
            <div className="absolute -right-[12mm] -top-[18mm] size-[48mm] rounded-full border-[0.7mm] border-white/15" />
            <div className="absolute -right-[3mm] -top-[8mm] size-[31mm] rounded-full bg-cyan-300/10" />
            <div className="absolute -bottom-[20mm] -left-[12mm] size-[43mm] rounded-full bg-fuchsia-400/15 blur-[1mm]" />
            <div className="absolute left-[3.8mm] right-[3.8mm] top-[3.5mm] flex h-[9mm] items-center justify-between">
              <div className="flex min-w-0 items-center gap-[2.2mm]">
                <div className="grid size-[9mm] shrink-0 place-items-center overflow-hidden rounded-[2.2mm] bg-white shadow-sm">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt=""
                      className="size-full object-contain p-[0.7mm]"
                    />
                  ) : (
                    <Star className="size-[5mm] fill-violet-500 text-violet-500" />
                  )}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="max-w-[45mm] truncate text-[3.5mm] font-bold tracking-tight">
                    {shopName}
                  </div>
                  <div className="mt-[0.5mm] text-[1.8mm] font-semibold uppercase tracking-[0.55mm] text-cyan-200">
                    Member · Loyalty Card
                  </div>
                </div>
              </div>
              <div className="rounded-full border border-white/25 bg-white/10 px-[2.2mm] py-[0.8mm] text-[1.8mm] font-bold uppercase tracking-[0.25mm] backdrop-blur-sm">
                {tierLabel[member.tier]}
              </div>
            </div>

            <div className="absolute left-[4mm] top-[16mm] w-[53mm]">
              <div className="text-[1.8mm] font-medium tracking-[0.25mm] text-violet-200">
                MEMBER NAME
              </div>
              <div className="mt-[0.5mm] truncate text-[4.2mm] font-bold leading-tight">
                {member.name}
              </div>
              <div className="mt-[1.4mm] flex items-center gap-[1.5mm]">
                <span className="rounded-[1.2mm] bg-white/15 px-[1.7mm] py-[0.7mm] font-mono text-[2.4mm] font-bold tracking-[0.45mm]">
                  {formatMemberCode(memberCode)}
                </span>
                <span className="text-[1.75mm] font-medium text-cyan-100">
                  ใช้แต้มได้ทุกสาขา
                </span>
              </div>
              <div className="mt-[1.5mm] text-[1.65mm] text-violet-100">
                100 บาท = 1 แต้ม&nbsp;&nbsp;·&nbsp;&nbsp;1 แต้ม = ส่วนลด 1 บาท
              </div>
              <div
                className={`mt-[0.7mm] text-[1.65mm] font-semibold ${
                  cardExpired ? "text-rose-200" : "text-cyan-100"
                }`}
              >
                เปิดใช้ {fmtDateTH(member.cardActivatedAt)} · หมดอายุ{" "}
                {fmtDateTH(member.cardExpiresAt)}
              </div>
            </div>

            <div className="absolute bottom-[3.6mm] left-[4mm] h-[11.5mm] w-[54mm] rounded-[1.5mm] bg-white px-[2mm] py-[1.3mm] shadow-sm">
              <svg
                ref={barcodeRef}
                className="block h-[7.2mm] w-full"
                aria-label={`บาร์โค้ด ${memberCode}`}
              />
              <div className="text-center font-mono text-[1.7mm] font-bold leading-none tracking-[0.55mm] text-slate-700">
                {formatMemberCode(memberCode)}
              </div>
            </div>

            <div className="absolute right-[4mm] top-[17mm] flex w-[19mm] flex-col items-center">
              <div className="grid size-[19mm] place-items-center rounded-[1.8mm] bg-white p-[1mm] shadow-lg">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR สมาชิก ${memberCode}`}
                    className="size-full"
                  />
                ) : (
                  <ScanLine className="size-[8mm] animate-pulse text-slate-400" />
                )}
              </div>
              <div className="mt-[1mm] text-center text-[1.65mm] font-semibold leading-tight text-white">
                สแกนก่อนชำระเงิน
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {cardExpired
            ? "บัตรนี้หมดอายุแล้ว ระบบตัดแต้มคงเหลือเป็น 0 และไม่อนุญาตให้ใช้บัตร · "
            : ""}
          ตั้งค่าการพิมพ์เป็น 100% หรือ Actual size และปิดขอบกระดาษ
          เพื่อรักษาขนาดมาตรฐานของบัตร PVC
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
          <Button
            disabled={!qrDataUrl}
            onClick={() => {
              if (cardRef.current) printMemberCardElement(cardRef.current);
            }}
          >
            <Printer className="mr-2 size-4" /> พิมพ์ / บันทึก PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
