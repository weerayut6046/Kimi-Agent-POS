/**
 * แปลงบิลขายเป็น ESC/POS bytes สำหรับเครื่องพิมพ์ความร้อน
 * layout เลียนแบบ ReceiptDoc (ใบเสร็จหน้าจอ) แต่เรียบง่ายแบบตัวอักษรล้วนตามสไตล์ใบเสร็จม้วน
 */
import { EscposBuilder, wrapText, type PaperWidth } from "./escpos";
import type { PrinterConfig } from "./printerTransport";

// --- format helpers (เลียนแบบ web/src/lib/format.ts — ฝั่ง server import จาก web/src ไม่ได้) ---
const fmtMoney = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
const fmtDateTimeTH = (d: Date | string) => {
  const dt = new Date(d);
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${p2(dt.getDate())}/${p2(dt.getMonth() + 1)}/${dt.getFullYear() + 543} ${p2(dt.getHours())}:${p2(dt.getMinutes())}:${p2(dt.getSeconds())}`;
};
const paymentLabel: Record<string, string> = { cash: "เงินสด", qr: "QR พร้อมเพย์", card: "บัตร", credit: "เครดิต" };

export type ReceiptPrintSale = {
  receiptNo: string;
  createdAt: Date | string;
  subtotal: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  paymentMethod: string;
  received: number;
  changeAmt: number;
  pointsEarned: number;
  pointsRedeemed: number;
};

export type ReceiptPrintItem = { name: string; qty: number; unit: string; unitPrice: number; amount: number };

export type ReceiptPrintInput = {
  sale: ReceiptPrintSale;
  items: ReceiptPrintItem[];
  settingMap: Record<string, string>;
  staffName?: string;
  memberName?: string | null;
};

type PrintCfg = Pick<PrinterConfig, "paperWidth" | "codepage" | "openDrawer">;

/** ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ ฉบับเครื่องพิมพ์ความร้อน */
export function buildReceiptEscpos(input: ReceiptPrintInput, cfg: PrintCfg): Buffer {
  const { sale, items, settingMap: s } = input;
  const p = new EscposBuilder({ width: cfg.paperWidth, codepage: cfg.codepage });

  // หัวใบเสร็จ — กึ่งกลาง
  p.align("center").bold(true);
  p.line(s.shop_name ?? "");
  if (s.shop_branch) p.line(`สาขา ${s.shop_branch}`);
  p.bold(false);
  for (const ln of (s.shop_address ?? "").split("\n")) {
    for (const w of wrapText(ln, p.lineWidth)) p.line(w);
  }
  if (s.shop_phone) p.line(`โทร. ${s.shop_phone}`);
  p.bold(true).line("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ").bold(false);
  if (s.tax_id) p.line(`เลขประจำตัวผู้เสียภาษี ${s.tax_id}`);

  // ข้อมูลบิล
  p.align("left").divider();
  p.line(`บิลเลขที่ : ${sale.receiptNo}`);
  p.line(`วันที่ : ${fmtDateTimeTH(sale.createdAt)}`);
  if (input.staffName) p.line(`พนักงาน : ${input.staffName}`);
  if (input.memberName) p.line(`สมาชิก : ${input.memberName}`);
  p.divider();

  // รายการสินค้า — ชื่อสินค้าเต็มบรรทัด แล้วบรรทัดรอง: จำนวน x ราคา ... ยอดเงิน (ชิดขวา)
  for (const it of items) {
    for (const w of wrapText(it.name, p.lineWidth)) p.line(w);
    p.row(`  ${fmtNum(it.qty)} ${it.unit} x ฿${fmtMoney(it.unitPrice)}`, fmtMoney(it.amount));
  }

  // ยอดรวม
  p.divider();
  p.row("รวม", fmtMoney(sale.subtotal));
  if (sale.discount > 0) p.bold(true).row("ส่วนลด", fmtMoney(sale.discount)).bold(false);
  p.bold(true).row("ยอดเงินสุทธิ", fmtMoney(sale.total)).bold(false);
  p.row(`ภาษีมูลค่าเพิ่ม ${fmtNum(sale.vatRate)}% (รวมใน)`, fmtMoney(sale.vatAmount));

  // การชำระเงิน
  p.divider();
  p.row("ชำระโดย", paymentLabel[sale.paymentMethod] ?? sale.paymentMethod);
  if (sale.paymentMethod === "cash") {
    p.row("รับเงิน", fmtMoney(sale.received));
    p.row("เงินทอน", fmtMoney(sale.changeAmt));
  }
  if (sale.pointsEarned > 0) p.row("แต้มที่ได้รับ", `+${sale.pointsEarned}`);
  if (sale.pointsRedeemed > 0) p.row("แต้มที่ใช้", `-${sale.pointsRedeemed}`);

  // หมายเหตุท้ายใบเสร็จ
  p.line();
  for (const w of wrapText("* ราคานี้รวมภาษีมูลค่าเพิ่มแล้ว", p.lineWidth)) p.line(w);
  for (const w of wrapText("** ต้องการใบกำกับภาษีเต็มรูป โปรดแจ้งเจ้าหน้าที่พร้อมใบเสร็จฉบับนี้", p.lineWidth)) p.line(w);
  p.align("center").line("ขอบคุณที่ใช้บริการ");

  if (cfg.openDrawer && sale.paymentMethod === "cash") p.drawerKick();
  p.cut();
  return p.build();
}

/** หน้ากระดาษทดสอบ — ใช้เช็กว่าตั้งค่า codepage/ขนาดกระดาษถูกกับเครื่องพิมพ์จริง */
export function buildTestEscpos(cfg: { paperWidth: PaperWidth; codepage: number }, shopName: string): Buffer {
  const p = new EscposBuilder({ width: cfg.paperWidth, codepage: cfg.codepage });
  p.align("center").bold(true).line("*** ทดสอบเครื่องพิมพ์ ***").bold(false);
  if (shopName) p.line(shopName);
  p.line(`กระดาษ ${cfg.paperWidth} มม. / codepage ${cfg.codepage}`);
  p.align("left").divider();
  p.line("ภาษาไทย ก-ฮ สระ วรรณยุกต์ ๆ");
  p.line("น้ำมัน ดีเซล แก๊สโซฮอล์ 95");
  p.line("English ABC xyz 1234567890");
  p.line("สัญลักษณ์ ฿ % @ # / - + =");
  p.row("ซ้าย", "ขวา");
  p.divider("=");
  p.align("center").line(fmtDateTimeTH(new Date()));
  p.line("ถ้าอ่านภาษาไทยออกถูกต้อง = ตั้งค่าสำเร็จ");
  p.cut();
  return p.build();
}
