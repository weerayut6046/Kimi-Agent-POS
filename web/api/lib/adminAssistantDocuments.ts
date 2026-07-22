import type { AssistantAction } from "@contracts/assistant";

export const ADMIN_DOCUMENT_TYPES = [
  "all",
  "daily_report",
  "sales_range",
  "receipt",
  "tax_invoice",
  "credit_application",
  "vehicle_fleet",
  "debt_receipt",
  "payroll",
] as const;

export type AdminDocumentType = (typeof ADMIN_DOCUMENT_TYPES)[number];

export type AdminDocumentRequest = {
  document: AdminDocumentType;
  date?: string;
  from?: string;
  to?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function bangkokDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function navigate(label: string, path: string): AssistantAction {
  return { kind: "navigate", label, path };
}

const documentCatalog: Array<{
  type: Exclude<AdminDocumentType, "all" | "daily_report" | "sales_range">;
  title: string;
  description: string;
  action: AssistantAction;
}> = [
  {
    type: "receipt",
    title: "ใบเสร็จรับเงิน",
    description: "ค้นหาบิล ดูรายละเอียด และพิมพ์ใบเสร็จ",
    action: navigate("เปิดใบเสร็จรับเงิน", "/sales"),
  },
  {
    type: "tax_invoice",
    title: "ใบกำกับภาษีเต็มรูป",
    description: "ค้นหา ดู และพิมพ์ใบกำกับภาษีที่มีอยู่",
    action: navigate("เปิดใบกำกับภาษี", "/tax-invoices"),
  },
  {
    type: "credit_application",
    title: "ใบขอเปิดบัญชีลูกค้าเครดิต",
    description: "เลือกข้อมูลลูกค้าภายใน PumpPOS แล้วพิมพ์แบบฟอร์ม A4",
    action: navigate(
      "เปิดใบขอเปิดบัญชีเครดิต",
      "/documents?type=credit-request"
    ),
  },
  {
    type: "vehicle_fleet",
    title: "รายการรถบรรทุก/เครื่องจักร",
    description: "เลือกข้อมูลลูกค้าภายใน PumpPOS แล้วพิมพ์แบบฟอร์ม A4",
    action: navigate(
      "เปิดรายการรถบรรทุก/เครื่องจักร",
      "/documents?type=vehicle-fleet"
    ),
  },
  {
    type: "debt_receipt",
    title: "ใบรับชำระหนี้",
    description: "เปิดลูกหนี้เพื่อรับชำระและพิมพ์ใบรับชำระ",
    action: navigate("เปิดใบรับชำระหนี้", "/debts"),
  },
  {
    type: "payroll",
    title: "รายการเงินเดือน",
    description: "เปิดรายการเงินเดือนของเดือนที่เลือก",
    action: navigate("เปิดรายการเงินเดือน", "/workforce?tab=payroll"),
  },
];

function validDate(value: string | undefined): value is string {
  if (!value || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

function daySpan(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  );
}

export function buildAdminDocumentResponse(request: AdminDocumentRequest): {
  answer: string;
  actions: AssistantAction[];
} {
  const today = bangkokDate();

  if (request.document === "daily_report") {
    const date = validDate(request.date) ? request.date : today;
    return {
      answer: `เตรียม Z-Report วันที่ ${date} ให้แล้ว สามารถดาวน์โหลด Excel หรือเปิดหน้ารายงานเพื่อพิมพ์/บันทึกเป็น PDF ได้`,
      actions: [
        {
          kind: "download_daily_report",
          label: `ดาวน์โหลด Z-Report ${date}`,
          date,
        },
        navigate("เปิดหน้ารายงานเพื่อพิมพ์ PDF", `/reports?date=${date}`),
      ],
    };
  }

  if (request.document === "sales_range") {
    if (!validDate(request.from) || !validDate(request.to)) {
      return {
        answer:
          "กรุณาระบุวันที่เริ่มต้นและสิ้นสุด เช่น “ขอรายงานยอดขาย Excel ตั้งแต่ 2026-07-01 ถึง 2026-07-22” (สูงสุด 92 วัน)",
        actions: [navigate("เปิดหน้าส่งออกรายงาน", "/reports")],
      };
    }
    const span = daySpan(request.from, request.to);
    if (span < 0 || span > 91) {
      return {
        answer: "ช่วงวันที่ไม่ถูกต้องหรือยาวเกิน 92 วัน กรุณาระบุช่วงใหม่",
        actions: [navigate("เปิดหน้าส่งออกรายงาน", "/reports")],
      };
    }
    return {
      answer: `เตรียมรายงานยอดขายช่วง ${request.from} ถึง ${request.to} สำหรับดาวน์โหลด Excel แล้ว`,
      actions: [
        {
          kind: "download_sales_range",
          label: `ดาวน์โหลดรายงาน ${request.from}–${request.to}`,
          from: request.from,
          to: request.to,
        },
      ],
    };
  }

  if (request.document !== "all") {
    const item = documentCatalog.find(entry => entry.type === request.document);
    if (item) {
      return {
        answer: `${item.title}: ${item.description}\nระบบจะให้เลือกบิลหรือลูกค้าที่เกี่ยวข้องภายใน PumpPOS เพื่อไม่ส่งข้อมูลส่วนบุคคลผ่านแชต`,
        actions: [item.action],
      };
    }
  }

  const dailyAction: AssistantAction = {
    kind: "download_daily_report",
    label: `ดาวน์โหลด Z-Report วันนี้ (${today})`,
    date: today,
  };
  return {
    answer: [
      "เอกสารที่ admin ขอผ่านแชตได้:",
      `- Z-Report รายวัน: ดาวน์โหลด Excel หรือเปิดเพื่อพิมพ์ PDF`,
      "- รายงานยอดขายตามช่วงเวลา: ระบุวันเริ่มต้นและวันสิ้นสุดเพื่อดาวน์โหลด Excel",
      ...documentCatalog.map(item => `- ${item.title}: ${item.description}`),
      "เอกสารที่มีข้อมูลลูกค้าหรือเลขบิลจะให้เลือกภายในหน้าระบบ ไม่ส่งข้อมูลนั้นให้ DeepSeek",
    ].join("\n"),
    actions: [
      dailyAction,
      navigate("เปิดศูนย์รายงาน", `/reports?date=${today}`),
      ...documentCatalog.map(item => item.action),
    ],
  };
}
