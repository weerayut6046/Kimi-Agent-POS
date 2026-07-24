import type {
  DailyReportData,
  FuelProfitRow,
  FuelStockPeriodRow,
  FuelStockProductRow,
  FuelStockSummaryData,
} from "./excelExport";
import { Buffer } from "node:buffer";

export type {
  DailyReportData,
  FuelProfitRow,
  FuelStockPeriodRow,
  FuelStockProductRow,
  FuelStockSummaryData,
};

type CellValue = string | number | boolean | Date | null | undefined;
type Sheet = { name: string; rows: CellValue[][] };

const encoder = new TextEncoder();
const PAY_LABEL: Record<string, string> = {
  cash: "เงินสด",
  qr: "QR พร้อมเพย์",
  card: "บัตร",
  credit: "เครดิต",
};
const DEBT_LABEL: Record<string, string> = {
  cash: "เงินสด",
  qr: "QR พร้อมเพย์",
  transfer: "โอน",
};

function fmtDateTH(value: Date | string): string {
  const date = new Date(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(
    date.getMonth() + 1,
  ).padStart(2, "0")}/${date.getFullYear() + 543}`;
}

function fmtDateTimeTH(value: Date | string): string {
  const date = new Date(value);
  return `${fmtDateTH(date)} ${String(date.getHours()).padStart(
    2,
    "0",
  )}:${String(date.getMinutes()).padStart(2, "0")}:${String(
    date.getSeconds(),
  ).padStart(2, "0")}`;
}

function xml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let result = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
  }
  return result;
}

function cellXml(value: CellValue, row: number, column: number): string {
  const reference = `${columnName(column)}${row + 1}`;
  if (value == null) return `<c r="${reference}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function worksheetXml(rows: CellValue[][]): string {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => cellXml(value, rowIndex, columnIndex))
          .join("")}</row>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function uint16(value: number): Uint8Array {
  return Uint8Array.of(value & 255, (value >>> 8) & 255);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(
    value & 255,
    (value >>> 8) & 255,
    (value >>> 16) & 255,
    (value >>> 24) & 255,
  );
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: Array<{ name: string; content: string }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concatBytes([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(crc),
      uint32(data.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
      name,
      data,
    ]);
    localParts.push(local);

    centralParts.push(
      concatBytes([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(crc),
        uint32(data.length),
        uint32(data.length),
        uint16(name.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(localOffset),
        name,
      ]),
    );
    localOffset += local.length;
  }

  const central = concatBytes(centralParts);
  return concatBytes([
    ...localParts,
    central,
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(files.length),
    uint16(files.length),
    uint32(central.length),
    uint32(localOffset),
    uint16(0),
  ]);
}

function workbook(sheets: Sheet[]): Buffer {
  const safeSheets = sheets.map((sheet, index) => ({
    ...sheet,
    name: sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Sheet${index + 1}`,
  }));
  const contentTypes = safeSheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const workbookSheets = safeSheets
    .map(
      (sheet, index) =>
        `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const workbookRelationships = safeSheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");

  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentTypes}</Types>`,
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships}</Relationships>`,
    },
    ...safeSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet.rows),
    })),
  ];
  return Buffer.from(zipStore(files));
}

export async function buildDailyWorkbook(
  daily: DailyReportData,
): Promise<Buffer> {
  return workbook([
    {
      name: "สรุป",
      rows: [
        [`รายงานปิดวัน (Z-Report) — ${fmtDateTH(`${daily.date}T00:00:00`)}`],
        [],
        ["วันที่", daily.date],
        ["ยอดขาย", daily.totalSales],
        ["จำนวนบิล", daily.billCount],
        ["บิลยกเลิก", daily.voidedCount, "ยอดยกเลิก", daily.voidedTotal],
        ["ส่วนลด", daily.discountTotal],
        ["VAT", daily.vatTotal],
        ["ลิตรรวม", daily.totalLiters],
        ["ค่าใช้จ่าย", daily.expenses.total],
        ["รับชำระหนี้", daily.debtPayments.total],
        ["เงินสดคาดหวัง", daily.expectedCash],
        [],
        ["แยกตามวิธีชำระ", "จำนวนบิล", "ยอดเงิน"],
        ...Object.entries(daily.byMethod).map(([method, value]) => [
          PAY_LABEL[method] ?? method,
          value.count,
          value.total,
        ]),
        [],
        ["รับชำระหนี้แยกวิธี", "ยอดเงิน"],
        ...Object.entries(daily.debtPayments.byMethod).map(
          ([method, value]) => [DEBT_LABEL[method] ?? method, value],
        ),
      ],
    },
    {
      name: "ลิตรและกำไรน้ำมัน",
      rows: [
        [
          "ชนิดน้ำมัน",
          "ลิตร",
          "ยอดขาย (บาท)",
          "ต้นทุน/ลิตร",
          "กำไร/ลิตร",
          "กำไรรวม (บาท)",
        ],
        ...daily.fuelProfit.map(item => [
          item.name,
          item.liters,
          item.revenue,
          item.costPerLiter,
          item.profitPerLiter,
          item.profitTotal,
        ]),
      ],
    },
    {
      name: "กะการทำงาน",
      rows: [
        [
          "กะ",
          "พนักงาน",
          "เปิด",
          "ปิด",
          "สถานะ",
          "ลิตร",
          "ยอดลิตร×ราคา",
          "ยอด P",
          "ยอด POS",
          "เงินทอน",
          "เงินสดควรมี",
          "นับได้",
          "ต่าง",
        ],
        ...daily.shifts.map(shift => [
          `#${shift.id}`,
          shift.staffName,
          fmtDateTimeTH(shift.openedAt),
          shift.closedAt ? fmtDateTimeTH(shift.closedAt) : "-",
          shift.status === "open" ? "กำลังเปิด" : "ปิดแล้ว",
          shift.totalLiters,
          shift.totalAmount,
          shift.totalMoneyMeter,
          shift.posAmount,
          shift.openingFloat,
          shift.cashExpected,
          shift.countedCash,
          shift.cashDiff,
        ]),
      ],
    },
    {
      name: "ค่าใช้จ่าย",
      rows: [
        ["เวลา", "รายการ", "หมวด", "พนักงาน", "จำนวนเงิน"],
        ...daily.expenses.items.map(expense => [
          fmtDateTimeTH(expense.createdAt),
          expense.title,
          expense.category,
          expense.staffName || "-",
          expense.amount,
        ]),
      ],
    },
    {
      name: "ชำระหนี้",
      rows: [
        ["เลขที่", "เวลา", "ลูกค้า", "วิธีชำระ", "จำนวนเงิน"],
        ...daily.debtPayments.items.map(payment => [
          payment.paymentNo,
          fmtDateTimeTH(payment.createdAt),
          payment.customerName,
          DEBT_LABEL[payment.method] ?? payment.method,
          payment.amount,
        ]),
      ],
    },
    {
      name: "บิลขาย",
      rows: [
        [
          "เลขที่",
          "วันเวลา",
          "พนักงาน",
          "วิธีชำระ",
          "ยอดก่อนลด",
          "ส่วนลด",
          "VAT",
          "ยอดรวม",
          "สถานะ",
        ],
        ...daily.bills.map(bill => [
          bill.receiptNo,
          fmtDateTimeTH(bill.createdAt),
          bill.staffName,
          PAY_LABEL[bill.paymentMethod] ?? bill.paymentMethod,
          bill.subtotal,
          bill.discount,
          bill.vatAmount,
          bill.total,
          bill.status === "voided" ? "ยกเลิก" : "สำเร็จ",
        ]),
      ],
    },
  ]);
}

export async function buildRangeWorkbook(input: {
  from: string;
  to: string;
  days: DailyReportData[];
  profit: FuelProfitRow[];
}): Promise<Buffer> {
  return workbook([
    {
      name: "สรุปรายวัน",
      rows: [
        [
          `รายงานยอดขาย ${fmtDateTH(
            `${input.from}T00:00:00`,
          )} – ${fmtDateTH(`${input.to}T00:00:00`)}`,
        ],
        [],
        [
          "วันที่",
          "ยอดขาย",
          "บิล",
          "ยกเลิก",
          "ส่วนลด",
          "VAT",
          "เงินสด",
          "QR",
          "บัตร",
          "เครดิต",
          "ลิตร",
          "ค่าใช้จ่าย",
          "ชำระหนี้",
          "เงินสดคาดหวัง",
        ],
        ...input.days.map(day => [
          day.date,
          day.totalSales,
          day.billCount,
          day.voidedCount,
          day.discountTotal,
          day.vatTotal,
          day.byMethod.cash.total,
          day.byMethod.qr.total,
          day.byMethod.card.total,
          day.byMethod.credit.total,
          day.totalLiters,
          day.expenses.total,
          day.debtPayments.total,
          day.expectedCash,
        ]),
        ...(input.days.length > 0
          ? [
              [
                "รวม",
                input.days.reduce((sum, day) => sum + day.totalSales, 0),
                input.days.reduce((sum, day) => sum + day.billCount, 0),
                input.days.reduce((sum, day) => sum + day.voidedCount, 0),
                input.days.reduce((sum, day) => sum + day.discountTotal, 0),
                input.days.reduce((sum, day) => sum + day.vatTotal, 0),
                input.days.reduce(
                  (sum, day) => sum + day.byMethod.cash.total,
                  0,
                ),
                input.days.reduce(
                  (sum, day) => sum + day.byMethod.qr.total,
                  0,
                ),
                input.days.reduce(
                  (sum, day) => sum + day.byMethod.card.total,
                  0,
                ),
                input.days.reduce(
                  (sum, day) => sum + day.byMethod.credit.total,
                  0,
                ),
                input.days.reduce((sum, day) => sum + day.totalLiters, 0),
                input.days.reduce(
                  (sum, day) => sum + day.expenses.total,
                  0,
                ),
                input.days.reduce(
                  (sum, day) => sum + day.debtPayments.total,
                  0,
                ),
                input.days.reduce((sum, day) => sum + day.expectedCash, 0),
              ],
            ]
          : []),
      ],
    },
    {
      name: "บิลขาย",
      rows: [
        [
          "เลขที่",
          "วันเวลา",
          "พนักงาน",
          "วิธีชำระ",
          "ยอดก่อนลด",
          "ส่วนลด",
          "VAT",
          "ยอดรวม",
          "สถานะ",
        ],
        ...input.days.flatMap(day =>
          day.bills.map(bill => [
            bill.receiptNo,
            fmtDateTimeTH(bill.createdAt),
            bill.staffName,
            PAY_LABEL[bill.paymentMethod] ?? bill.paymentMethod,
            bill.subtotal,
            bill.discount,
            bill.vatAmount,
            bill.total,
            bill.status === "voided" ? "ยกเลิก" : "สำเร็จ",
          ]),
        ),
      ],
    },
    {
      name: "ลิตรและกำไรน้ำมัน",
      rows: [
        [
          "ชนิดน้ำมัน",
          "ลิตร",
          "ยอดขาย (บาท)",
          "ต้นทุน/ลิตร",
          "กำไร/ลิตร",
          "กำไรรวม (บาท)",
        ],
        ...input.profit.map(item => [
          item.name,
          item.liters,
          item.revenue,
          item.costPerLiter,
          item.profitPerLiter,
          item.profitTotal,
        ]),
      ],
    },
  ]);
}

export async function buildFuelStockWorkbook(
  report: FuelStockSummaryData,
  periodKey: string,
): Promise<Buffer> {
  const period = report.periods.find(item => item.key === periodKey);
  if (!period) throw new Error("ไม่พบงวดสำหรับสร้างไฟล์สรุปสต๊อกน้ำมัน");
  const currentByProduct = new Map(
    report.currentProducts.map(product => [product.productId, product]),
  );
  const products = period.products.filter(product => {
    const current = currentByProduct.get(product.productId);
    return (
      (current?.tankCount ?? 0) > 0 ||
      product.receivedLiters > 0 ||
      product.soldLiters > 0
    );
  });
  return workbook([
    {
      name: "สรุปสต๊อกน้ำมัน",
      rows: [
        [
          `สรุปยอดสต๊อกน้ำมัน — ${period.label}${
            period.isPartial ? " (ถึงปัจจุบัน)" : ""
          }`,
        ],
        [
          "ขายออก = รวมลิตรจากรายการขาย POS ที่สำเร็จ | ยอดขาย = รวมเงินจากรายการขาย POS ที่สำเร็จ | กำไรรวม = กำไร/ลิตร × รับเข้า",
        ],
        [
          "รหัส",
          "ชนิดน้ำมัน",
          "รับเข้า (ลิตร)",
          "ราคาซื้อ/ลิตร",
          "มูลค่าซื้อ",
          "ขายออก (ลิตร)",
          "ราคาขาย/ลิตร",
          "ยอดขาย",
          "กำไร/ลิตร",
          "กำไรรวม",
          "คงเหลือปัจจุบัน (ลิตร)",
        ],
        ...products.map(product => [
          product.code,
          product.name,
          product.receivedLiters,
          product.avgPurchaseCost,
          product.purchaseCost,
          product.soldLiters,
          product.avgSalePrice,
          product.revenue,
          product.profitPerLiter,
          product.stockProfit,
          currentByProduct.get(product.productId)?.currentLiters ?? 0,
        ]),
        [
          "",
          "รวมงวด",
          period.receivedLiters,
          period.avgPurchaseCost,
          period.purchaseCost,
          period.soldLiters,
          period.avgSalePrice,
          period.revenue,
          period.profitPerLiter,
          period.stockProfit,
          "แยกตามชนิด",
        ],
      ],
    },
  ]);
}
