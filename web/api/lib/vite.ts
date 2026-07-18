import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  // Electron ตั้ง POS_STATIC_DIR ชี้ dist/public ในแพ็กเกจเสมอ
  // ส่วน server ปกติ (node dist/boot.js) ใช้ path เทียบจากไฟล์ bundle
  const distPath = process.env.POS_STATIC_DIR
    ? path.resolve(process.env.POS_STATIC_DIR)
    : path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", serveStatic({ root: distPath }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
