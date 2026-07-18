import { z } from "zod";
import { eq, like, ne } from "drizzle-orm";
import { createRouter, publicQuery } from "../middleware";
import { adminQuery } from "../guard";
import { getDb } from "../queries/connection";
import { members, saleItems, sales, settings } from "@db/schema";
import { sendToPrinter, type PrinterConfig } from "../lib/printerTransport";
import { buildReceiptEscpos, buildTestEscpos } from "../lib/receiptPrint";

/** ค่าเริ่มต้นเมื่อ DB ยังไม่มี key printer_* (ฐานข้อมูลเก่าที่ seed ก่อนมีฟีเจอร์นี้) */
const PRINTER_DEFAULTS: Record<string, string> = {
  printer_enabled: "0",
  printer_mode: "network",
  printer_host: "",
  printer_port: "9100",
  printer_share: "",
  printer_width: "80",
  printer_auto_print: "1",
  printer_open_drawer: "0",
  printer_codepage: "96",
};

async function loadPrinterConfig(db: ReturnType<typeof getDb>): Promise<PrinterConfig> {
  const rows = await db.select().from(settings).where(like(settings.key, "printer_%"));
  const m = { ...PRINTER_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return {
    enabled: m.printer_enabled === "1",
    mode: m.printer_mode === "windows_share" ? "windows_share" : "network",
    host: m.printer_host.trim(),
    port: Number(m.printer_port) || 9100,
    share: m.printer_share.trim(),
    paperWidth: m.printer_width === "58" ? "58" : "80",
    codepage: Number(m.printer_codepage) || 96,
    autoPrint: m.printer_auto_print !== "0",
    openDrawer: m.printer_open_drawer === "1",
  };
}

export const printerRouter = createRouter({
  /** ค่าตั้งเครื่องพิมพ์ปัจจุบัน (หน้า Settings ใช้แสดง/แก้ผ่าน catalog.updateSettings) */
  getConfig: publicQuery.query(async () => loadPrinterConfig(getDb())),

  /** พิมพ์หน้ากระดาษทดสอบตามค่าที่บันทึกไว้ — admin เท่านั้น */
  testPrint: adminQuery.mutation(async () => {
    const db = getDb();
    const cfg = await loadPrinterConfig(db);
    const shop = await db.query.settings.findFirst({ where: eq(settings.key, "shop_name") });
    await sendToPrinter(cfg, buildTestEscpos(cfg, shop?.value ?? ""));
    return { ok: true };
  }),

  /** พิมพ์ใบเสร็จของบิล (พิมพ์ใหม่ได้ไม่จำกัด — ไม่แตะข้อมูลบิล) */
  printReceipt: publicQuery.input(z.object({ saleId: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    const cfg = await loadPrinterConfig(db);
    if (!cfg.enabled) throw new Error("ยังไม่ได้เปิดใช้งานเครื่องพิมพ์ความร้อน — เปิดได้ที่หน้าตั้งค่าระบบ");

    const sale = await db.query.sales.findFirst({ where: eq(sales.id, input.saleId) });
    if (!sale) throw new Error("ไม่พบบิล");
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    const member = sale.memberId
      ? await db.query.members.findFirst({ where: eq(members.id, sale.memberId) })
      : null;
    const settingRows = await db.select().from(settings).where(ne(settings.key, "shop_logo"));
    const settingMap = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

    const data = buildReceiptEscpos(
      { sale, items, settingMap, staffName: sale.staffName, memberName: member?.name ?? null },
      cfg,
    );
    await sendToPrinter(cfg, data);
    return { ok: true };
  }),
});
