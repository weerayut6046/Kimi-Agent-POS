import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/** สีน้ำเงินหลักของฟอร์มเครดิต — ใช้ hex ตรงๆ เพื่อให้สั่งพิมพ์ได้สีเดิมทุกเครื่อง */
export const FORM_BLUE = "#1d3a8f";

type SettingMap = Record<string, string> | undefined;

/** หัวฟอร์ม: โลโก้+ข้อมูลร้าน ด้านบน ตามด้วยชื่อฟอร์มตัวใหญ่สีน้ำเงิน */
export function CreditFormHeader({
  title,
  subtitle,
  settingMap,
  logoUrl,
}: {
  title: string;
  subtitle: string;
  settingMap?: SettingMap;
  logoUrl?: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        {logoUrl && (
          <img
            src={logoUrl}
            alt="โลโก้ร้าน"
            className="h-12 w-auto object-contain shrink-0"
          />
        )}
        <div className="min-w-0">
          <div
            className="font-bold text-[14px] leading-tight"
            style={{ color: FORM_BLUE }}
          >
            {settingMap?.shop_name}
            {settingMap?.shop_branch ? ` สาขา ${settingMap.shop_branch}` : ""}
          </div>
          {settingMap?.shop_address && (
            <div className="text-[9px] text-slate-600 whitespace-pre-line">
              {settingMap.shop_address}
            </div>
          )}
          <div className="text-[9px] text-slate-600">
            โทร. {settingMap?.shop_phone}
          </div>
        </div>
      </div>
      <div className="mt-1.5">
        <div
          className="text-[20px] font-extrabold leading-tight"
          style={{ color: FORM_BLUE }}
        >
          {title}
        </div>
        <div className="text-[13px] font-semibold" style={{ color: FORM_BLUE }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

/** แถบท้ายฟอร์มสีน้ำเงิน */
export function CreditFormFooter({ settingMap }: { settingMap?: SettingMap }) {
  return (
    <div
      className="mt-2 flex items-center justify-center gap-2 rounded-lg px-4 py-1 text-white"
      style={{ backgroundColor: FORM_BLUE }}
    >
      <Phone className="size-3.5" />
      <span className="text-[11px] font-semibold">
        โทร. {settingMap?.shop_phone}
      </span>
    </div>
  );
}

/** หัวข้อแบบแคปซูลสีน้ำเงิน พร้อมวงกลมเลขกำกับ (ไม่ใส่ no = แคปซูลธรรมดา) */
export function SectionPill({ no, title }: { no?: string; title: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full py-0.5 pl-1 pr-4 text-white"
      style={{ backgroundColor: FORM_BLUE }}
    >
      {no && (
        <span
          className="grid size-[18px] shrink-0 place-items-center rounded-full bg-white text-[10px] font-bold"
          style={{ color: FORM_BLUE }}
        >
          {no}
        </span>
      )}
      <span className={cn("text-[11px] font-bold", !no && "pl-2")}>
        {title}
      </span>
    </div>
  );
}

/** กล่องเนื้อหามุมโค้งใต้หัวข้อ */
export function SectionBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mt-1 rounded-xl border border-slate-400 p-2", className)}
    >
      {children}
    </div>
  );
}

/** บรรทัดกรอกข้อมูล "ป้ายกำกับ ....ค่า...." — มีค่าจากระบบพิมพ์ทับบนเส้นให้; center = จัดกึ่งกลาง (เส้นความกว้างคงที่ ใช้ในกล่องลายเซ็น) */
export function FillLine({
  label,
  value,
  suffix,
  className,
  center,
}: {
  label?: string;
  value?: string | null;
  suffix?: string;
  className?: string;
  center?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-end gap-1.5",
        center && "justify-center",
        className
      )}
    >
      {label && <span className="shrink-0">{label}</span>}
      <span
        className={cn(
          "border-b border-dotted border-slate-500 leading-[1.2]",
          center ? "w-36 shrink-0 text-center" : "min-w-[36px] flex-1 pl-1"
        )}
      >
        {value?.trim() || "\u00A0"}
      </span>
      {suffix && <span className="shrink-0">{suffix}</span>}
    </div>
  );
}

/** ช่องทำเครื่องหมายสี่เหลี่ยม + ข้อความ (พิมพ์ได้แน่นอนกว่าอักขระ ☐) */
export function CheckLine({
  label,
  className,
}: {
  label: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-block size-3 shrink-0 border border-slate-600" />
      <span>{label}</span>
    </span>
  );
}

/** เลขประจำตัวผู้เสียภาษี 13 หลักแบบช่องสี่เหลี่ยม (1-5-4-1-2) — มีเลขจากระบบใส่ให้ในช่อง */
export function TaxIdBoxes({ taxId }: { taxId?: string }) {
  const digits = (taxId ?? "").replace(/\D/g, "").padEnd(13, " ").slice(0, 13);
  const groups = [1, 5, 4, 1, 2];
  let i = 0;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {groups.map((len, g) => (
        <span key={g} className="inline-flex items-center gap-[3px]">
          {g > 0 && <span className="mx-0.5">-</span>}
          {Array.from({ length: len }, (_, k) => (
            <span
              key={k}
              className="grid size-4 place-items-center border border-slate-500 text-[10px] font-semibold"
            >
              {digits[i++]?.trim()}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** ข้อเงื่อนไขพร้อมวงกลมเลขกำกับ */
export function TermItem({
  no,
  children,
}: {
  no: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-1.5">
      <span
        className="mt-[1px] grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
        style={{ backgroundColor: FORM_BLUE }}
      >
        {no}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** กล่องลายเซ็นท้ายฟอร์ม */
export function SignBox({
  heading,
  children,
  className,
}: {
  heading?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-slate-400 p-2.5", className)}>
      {heading && (
        <div className="mb-1.5 text-center font-semibold">{heading}</div>
      )}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/** บรรทัด "ลงชื่อ ....ชื่อเต็ม.... ตำแหน่งท้ายเส้น" — center = จัดกึ่งกลางกล่อง (เส้นความกว้างคงที่ ชื่ออยู่กลางเส้น) */
export function SignLine({
  role,
  name,
  center,
}: {
  role?: string;
  name?: string;
  center?: boolean;
}) {
  return (
    <div className={cn("flex items-end gap-1.5", center && "justify-center")}>
      <span className="shrink-0">ลงชื่อ</span>
      <span
        className={cn(
          "border-b border-dotted border-slate-500 text-center leading-[1.2]",
          center ? "w-36 shrink-0" : "min-w-[36px] flex-1"
        )}
      >
        {name?.trim() || "\u00A0"}
      </span>
      {role && <span className="shrink-0">{role}</span>}
    </div>
  );
}

/** บรรทัดวงเล็บชื่อตัวบรรจง */
export function ParenName() {
  return (
    <div className="text-center">
      (
      ............................................................................
      )
    </div>
  );
}

/** บรรทัด วันที่ ...../...../..... */
export function DateLine({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-1.5", className)}>
      <span>วันที่</span>
      <span className="inline-block w-10 border-b border-dotted border-slate-500">
        &nbsp;
      </span>
      <span>/</span>
      <span className="inline-block w-10 border-b border-dotted border-slate-500">
        &nbsp;
      </span>
      <span>/</span>
      <span className="inline-block w-14 border-b border-dotted border-slate-500">
        &nbsp;
      </span>
    </div>
  );
}
