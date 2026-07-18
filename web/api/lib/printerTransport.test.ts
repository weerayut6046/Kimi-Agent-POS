import { describe, it, expect } from "vitest";
import net from "node:net";
import { sendToPrinter, type PrinterConfig } from "./printerTransport";

const baseCfg: PrinterConfig = {
  enabled: true,
  mode: "network",
  host: "127.0.0.1",
  port: 0,
  share: "",
  paperWidth: "80",
  codepage: 96,
  autoPrint: true,
  openDrawer: false,
};

/** เปิด TCP server ปลอมเป็นเครื่องพิมพ์ รับ bytes จน client ปิด connection แล้วคืนค่าที่รับได้ */
function withMockPrinter<T>(fn: (port: number) => Promise<T>): Promise<{ result: T; received: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let resultPromise: Promise<T> | null = null;
    const server = net.createServer((socket) => {
      socket.on("data", (d) => chunks.push(d));
      socket.on("close", async () => {
        server.close();
        if (!resultPromise) return reject(new Error("ยังไม่ได้เรียกฟังก์ชันทดสอบ"));
        try {
          resolve({ result: await resultPromise, received: Buffer.concat(chunks) });
        } catch (e) {
          reject(e);
        }
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resultPromise = fn(port);
      resultPromise.catch((e) => {
        server.close();
        reject(e);
      });
    });
  });
}

describe("sendToPrinter (network)", () => {
  it("ส่ง bytes ครบถ้วนผ่าน TCP ไปยังเครื่องพิมพ์", async () => {
    const payload = Buffer.from([0x1b, 0x40, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x0a]);
    const { received } = await withMockPrinter((port) =>
      sendToPrinter({ ...baseCfg, port }, payload),
    );
    expect(received).toEqual(payload);
  });

  it("เชื่อมต่อไม่ได้ → error ภาษาไทย", async () => {
    // port 1 แทบไม่มีทางเปิดอยู่
    await expect(sendToPrinter({ ...baseCfg, port: 1 }, Buffer.from("x"))).rejects.toThrow(
      /เชื่อมต่อเครื่องพิมพ์/,
    );
  });

  it("ไม่ได้ตั้ง IP → error ชัดเจน", async () => {
    await expect(sendToPrinter({ ...baseCfg, host: "", port: 9100 }, Buffer.from("x"))).rejects.toThrow(
      "ยังไม่ได้ตั้งค่า IP เครื่องพิมพ์",
    );
  });
});

describe("sendToPrinter (windows_share)", () => {
  it("path ไม่ขึ้นต้น \\\\ → error ชัดเจน", async () => {
    await expect(
      sendToPrinter({ ...baseCfg, mode: "windows_share", share: "POS80" }, Buffer.from("x")),
    ).rejects.toThrow(/ขึ้นต้นด้วย/);
  });
});
