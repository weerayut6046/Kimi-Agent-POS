import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timingSafeEqual } from "crypto";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { streamSSE } from "hono/streaming";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { activeStaffSessionFromRequest } from "./lib/authorization";
import { RealtimeCapacityError, subscribeRealtime } from "./lib/realtime";
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
app.get("/api/realtime", async c => {
  const session = await activeStaffSessionFromRequest(c.req.raw);
  if (!session) {
    c.header("Cache-Control", "no-store");
    return c.json({ error: "Unauthorized" }, 401);
  }
  let deliver: (data: string) => void = () => undefined;
  let unsubscribe: () => void;
  try {
    unsubscribe = subscribeRealtime(session.id, event => {
      deliver(JSON.stringify(event));
    });
  } catch (error) {
    if (error instanceof RealtimeCapacityError) {
      c.header("Cache-Control", "no-store");
      return c.json({ error: "Realtime temporarily unavailable" }, 503);
    }
    throw error;
  }

  const response = streamSSE(c, async stream => {
    let active = true;
    let finish: () => void = () => undefined;
    let writes = Promise.resolve();
    const done = new Promise<void>(resolve => {
      finish = resolve;
    });

    const stop = () => {
      if (!active) return;
      active = false;
      finish();
    };
    const enqueue = (event: string, data: string) => {
      if (!active) return;
      writes = writes
        .then(() => stream.writeSSE({ event, data, retry: 1_000 }))
        .catch(stop);
    };

    deliver = data => enqueue("invalidate", data);
    stream.onAbort(stop);
    enqueue("ready", "{}");

    const heartbeat = setInterval(() => enqueue("heartbeat", "{}"), 15_000);
    const expiresInMs = Math.max(1, session.exp * 1_000 - Date.now());
    const expiry = setTimeout(stop, expiresInMs);

    try {
      await done;
      await writes;
    } finally {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unsubscribe();
    }
  });
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, private, no-transform"
  );
  response.headers.set("X-Accel-Buffering", "no");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
});
app.use("/api/trpc/*", async c => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
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
