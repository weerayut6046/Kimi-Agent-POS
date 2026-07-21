import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timingSafeEqual } from "crypto";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import {
  BackupInProgressError,
  createDatabaseBackup,
} from "./lib/databaseBackup";

const app = new Hono<{ Bindings: HttpBindings }>();

function isAuthorizedBackupScheduler(request: Request): boolean {
  if (!env.backupCronSecret) return false;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(env.backupCronSecret);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.post("/api/internal/database-backup", async c => {
  c.header("Cache-Control", "no-store");
  if (!isAuthorizedBackupScheduler(c.req.raw)) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const backup = await createDatabaseBackup("scheduled");
    return c.json({
      ok: true,
      objectName: backup.objectName,
      sizeBytes: backup.sizeBytes,
      createdAt: backup.createdAt.toISOString(),
      sha256: backup.sha256,
    });
  } catch (error) {
    if (error instanceof BackupInProgressError) {
      return c.json({ ok: false, error: "Backup already in progress" }, 409);
    }
    console.error("สำรองฐานข้อมูลตามเวลาไม่สำเร็จ:", error);
    return c.json({ ok: false, error: "Database backup failed" }, 500);
  }
});
app.use("/api/trpc/*", async c => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", c => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  void (async () => {
    const { serve } = await import("@hono/node-server");
    const { serveStaticFiles } = await import("./lib/vite");
    serveStaticFiles(app);

    const port = parseInt(process.env.PORT || "3000");
    const hostname = process.env.BIND_HOST || "0.0.0.0";
    serve({ fetch: app.fetch, port, hostname }, () => {
      console.log(`Server running on http://${hostname}:${port}/`);
    });
  })();
}
