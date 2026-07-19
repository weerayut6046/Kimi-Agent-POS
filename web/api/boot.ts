import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import path from "path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { startAutoBackupScheduler } from "./lib/autobackup";
import { getDb } from "./queries/connection";
import { settings } from "@db/schema";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

/**
 * host ที่ server จะฟัง (production เท่านั้น):
 * 1. env BIND_HOST (Docker pin 0.0.0.0 ไว้ใน Dockerfile — container ต้องรับจากภายนอกเสมอ)
 * 2. desktop: อ่าน setting `lan_enabled` จากฐานข้อมูล (หน้า Settings) — เปิดแล้วเครื่องอื่นใน LAN เชื่อมต่อได้
 *    default ปิด (ฟังเฉพาะ 127.0.0.1); อ่านไม่สำเร็จ (ตารางยังไม่มีตอน boot ครั้งแรก) ถือว่าปิด
 */
function resolveBindHost(): string {
  if (process.env.BIND_HOST) return process.env.BIND_HOST;
  try {
    const row = getDb().select().from(settings).where(eq(settings.key, "lan_enabled")).get();
    return row?.value === "1" ? "0.0.0.0" : "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

if (env.isProduction) {
  // ไม่ใช้ top-level await เพื่อให้ bundle เป็น CJS สำหรับ Electron main ได้
  void (async () => {
    const { serve } = await import("@hono/node-server");
    const { serveStaticFiles } = await import("./lib/vite");
    serveStaticFiles(app);

    const port = parseInt(process.env.PORT || "3000");
    const hostname = resolveBindHost();
    serve({ fetch: app.fetch, port, hostname }, () => {
      console.log(`Server running on http://${hostname}:${port}/`);
      startAutoBackupScheduler();
    });
  })();
} else {
  // dev server (vite) ไม่มีขั้นตอน migrate ให้ — migrate ตอน boot ให้ schema ตรงโค้ดเสมอ
  // รัน sync ตรงนี้ (better-sqlite3 เป็น sync) เพื่อให้เสร็จก่อน request แรก
  // path อ้างอิง cwd = root ของ repo เหมือน drizzle.config.ts; migrate เป็น idempotent รันซ้ำตอน hot-reload ได้ไม่เสียหาย
  try {
    migrate(getDb(), { migrationsFolder: path.resolve("web/db/migrations") });
    console.log("[dev] database migrated");
  } catch (e) {
    console.error("[dev] database migration failed:", e);
  }
}
