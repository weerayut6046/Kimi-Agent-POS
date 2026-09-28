import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { ensureDockerEngine } from "./docker-runtime.mjs";

const MAX_BODY = 32 * 1024;
const STAGES = {
  idle: "เลือกฐานข้อมูลเพื่อเริ่มติดตั้ง",
  docker: "กำลังเปิด PostgreSQL ในเครื่อง",
  checking: "กำลังตรวจการเชื่อมต่อฐานข้อมูล",
  auth: "กำลังตรวจการเชื่อมต่อบัญชีผู้ใช้ Supabase",
  saving: "กำลังบันทึกค่าติดตั้งในเครื่องนี้",
  migrating: "กำลังเตรียมโครงสร้างฐานข้อมูลใหม่",
  seeding: "กำลังเตรียมข้อมูลเริ่มต้น",
  prepared: "ฐานข้อมูลพร้อมแล้ว กดเปิดระบบเพื่อตั้งค่าเจ้าของและร้าน",
  building: "กำลังเตรียมระบบสำหรับใช้งานกับ Supabase",
  launching: "กำลังเปิดระบบ",
  ready: "ระบบพร้อมเปิดแล้ว",
};

export class SetupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function privateValue(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 8192 || /[\r\n\0]/u.test(value)) {
    throw new SetupError(`กรุณาระบุ ${label} ให้ถูกต้อง`);
  }
  return value.trim();
}

function databaseUrl(value, label) {
  const text = privateValue(value, label);
  try {
    const url = new URL(text);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1)) throw new Error();
    // A disabled TLS certificate check must never become the default for cloud databases.
    if (["disable", "allow", "prefer", "no-verify"].includes(url.searchParams.get("sslmode"))) {
      throw new Error();
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      // drizzle-kit reads this URL directly; protect migrations as well as the probe.
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
    return text;
  } catch {
    throw new SetupError(`กรุณาตรวจ ${label} ใช้ลิงก์ PostgreSQL ที่เปิดการเชื่อมต่ออย่างปลอดภัย`);
  }
}

function portValue(value, fallback, label) {
  const text = String(value || fallback);
  if (!/^\d{2,5}$/u.test(text) || Number(text) < 1024 || Number(text) > 65535) {
    throw new SetupError(`กรุณาระบุ ${label} ระหว่าง 1024 ถึง 65535`);
  }
  return text;
}

function strongSecret(existing, random) {
  return typeof existing === "string" && existing.length >= 32 ? existing : random();
}

function supabaseDatabaseProject(connection) {
  const url = new URL(connection);
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/u.exec(url.hostname);
  if (direct) return direct[1];
  if (url.hostname.endsWith(".pooler.supabase.com")) return /\.([a-z0-9]+)$/u.exec(decodeURIComponent(url.username))?.[1] || "";
  return "";
}

function keyHasRole(key, prefix, legacyRole) {
  if (new RegExp(`^${prefix}[A-Za-z0-9_-]{10,}$`, "u").test(key)) return true;
  try {
    const parts = key.split(".");
    return parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role === legacyRole;
  } catch { return false; }
}

/** Fixed environment keys only. Secrets stay in the server's private file. */
export function setupEnvironment(input, existing = {}, random = () => randomBytes(32).toString("base64url")) {
  if (!input || !["supabase", "local"].includes(input.mode)) throw new SetupError("กรุณาเลือกฐานข้อมูล");
  const appPort = portValue(input.appPort, existing.LOCAL_APP_PORT || "3010", "พอร์ตระบบ");
  const developmentOnly = input.mode === "local" && input.developmentOnly === true;
  const existingSecret = existing.APP_SECRET || existing.LOCAL_APP_SECRET;
  const requestedSecret = input.appSecret ? privateValue(input.appSecret, "APP_SECRET เดิม") : undefined;
  if (requestedSecret && (requestedSecret.length < 32 || (existingSecret && requestedSecret !== existingSecret))) {
    throw new SetupError("APP_SECRET ต้องมีอย่างน้อย 32 ตัวอักษร และต้องใช้ค่าเดิมของระบบนี้เพื่อรักษาข้อมูลที่เข้ารหัส");
  }
  const env = {
    ...existing,
    PUMPPOS_DEPLOYMENT_MODE: "business",
    APP_SECRET: requestedSecret || strongSecret(existingSecret, random),
    PUMPPOS_INSTALLATION_CODE: strongSecret(existing.PUMPPOS_INSTALLATION_CODE, random),
    VITE_API_TRANSPORT: "node",
    VITE_USE_SUPABASE_EDGE_API: "false",
    VITE_SUPABASE_SECRET_KEY: "",
    VITE_SUPABASE_SERVICE_ROLE_KEY: "",
    BIND_HOST: "127.0.0.1",
    LOCAL_APP_PORT: appPort,
    APP_PORT: appPort,
    PORT: appPort,
    // Clear legacy credentials that could override the selected configuration.
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_JWKS: "",
    PUMPPOS_PROJECT_REF: "",
    SUPABASE_PROJECT_REF: "",
  };
  const appOrigin = `http://127.0.0.1:${appPort}`;
  // Preserve explicit remote origins, while allowing this exact local app origin.
  env.ALLOWED_ORIGINS = [...new Set([...(existing.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean), appOrigin])].join(",");

  if (input.mode === "local") {
    const postgresPort = portValue(input.postgresPort, existing.LOCAL_POSTGRES_PORT || "54329", "พอร์ตฐานข้อมูล");
    if (postgresPort === appPort) throw new SetupError("พอร์ตระบบและพอร์ตฐานข้อมูลต้องต่างกัน");
    const password = input.postgresPassword ? privateValue(input.postgresPassword, "รหัสผ่าน PostgreSQL เดิม") : existing.LOCAL_POSTGRES_PASSWORD || random();
    env.LOCAL_POSTGRES_PASSWORD = password;
    env.LOCAL_POSTGRES_PORT = postgresPort;
    env.DATABASE_URL = `postgresql://pumppos:${encodeURIComponent(password)}@127.0.0.1:${postgresPort}/pumppos`;
    env.DIRECT_URL = env.DATABASE_URL;
    env.SUPABASE_DB_URL = "";
  } else {
    const saved = input.useSaved === true;
    if (saved && existing.LOCAL_AUTH_ENABLED !== "false") throw new SetupError("ยังไม่มีค่าติดตั้ง Supabase ที่บันทึกไว้");
    env.DATABASE_URL = databaseUrl(saved ? existing.SUPABASE_DB_URL || existing.DATABASE_URL : input.databaseUrl, "Database URL");
    env.DIRECT_URL = databaseUrl(saved ? existing.DIRECT_URL || env.DATABASE_URL : input.directUrl || env.DATABASE_URL, "Direct URL");
    env.SUPABASE_DB_URL = env.DATABASE_URL;
  }
  if (developmentOnly) {
    env.SUPABASE_URL = "";
    env.SUPABASE_PUBLISHABLE_KEY = "";
    env.SUPABASE_SECRET_KEY = "";
    env.VITE_SUPABASE_URL = "";
    env.VITE_SUPABASE_PUBLISHABLE_KEY = "";
    env.VITE_SUPABASE_ANON_KEY = "";
    env.LOCAL_AUTH_ENABLED = "true";
    env.VITE_LOCAL_AUTH_ENABLED = "true";
    env.NODE_ENV = "development";
  } else {
    const saved = input.useSaved === true;
    if (saved && existing.LOCAL_AUTH_ENABLED !== "false") throw new SetupError("ยังไม่มีค่าติดตั้ง Supabase ที่บันทึกไว้");
    const urlText = privateValue(saved ? existing.SUPABASE_URL : input.supabaseUrl, "Supabase URL");
    try {
      const url = new URL(urlText);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname || (url.pathname !== "/" && url.pathname !== "")) throw new Error();
      env.SUPABASE_URL = url.origin;
    } catch {
      throw new SetupError("Supabase URL ต้องเป็น HTTPS ของโปรเจกต์ที่ต้องการใช้งาน");
    }
    env.SUPABASE_PUBLISHABLE_KEY = privateValue(saved ? existing.SUPABASE_PUBLISHABLE_KEY || existing.SUPABASE_ANON_KEY : input.publishableKey, "Publishable key");
    env.SUPABASE_SECRET_KEY = privateValue(saved ? existing.SUPABASE_SECRET_KEY || existing.SUPABASE_SERVICE_ROLE_KEY : input.secretKey, "Secret key");
    if (!keyHasRole(env.SUPABASE_PUBLISHABLE_KEY, "sb_publishable_", "anon") || !keyHasRole(env.SUPABASE_SECRET_KEY, "sb_secret_", "service_role")) {
      throw new SetupError("กรุณาแยก Publishable key และ Secret key ให้ถูกต้อง");
    }
    if (input.mode === "supabase") {
      const project = /^([a-z0-9]+)\.supabase\.co$/u.exec(new URL(env.SUPABASE_URL).hostname)?.[1];
      if (!project || supabaseDatabaseProject(env.DATABASE_URL) !== project || supabaseDatabaseProject(env.DIRECT_URL) !== project) {
        throw new SetupError("Database URL, Direct URL และ Supabase URL ต้องเป็นโปรเจกต์ Supabase เดียวกัน");
      }
    }
    env.VITE_SUPABASE_URL = env.SUPABASE_URL;
    env.VITE_SUPABASE_PUBLISHABLE_KEY = env.SUPABASE_PUBLISHABLE_KEY;
    env.VITE_SUPABASE_ANON_KEY = "";
    env.LOCAL_AUTH_ENABLED = "false";
    env.VITE_LOCAL_AUTH_ENABLED = "false";
    env.NODE_ENV = "production";
  }
  return env;
}

export function serializeEnvironment(env) {
  return "# Private configuration written by npm run setup:system. Do not share.\n" + Object.entries(env)
    .filter(([key, value]) => /^[A-Z][A-Z0-9_]*$/u.test(key) && typeof value === "string")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n";
}

async function readEnvironment(workspace) {
  const read = async name => {
    try { return parse(await fs.readFile(path.join(workspace, name))); }
    catch (error) { if (error.code === "ENOENT") return {}; throw error; }
  };
  const [base, local] = await Promise.all([read(".env"), read(".env.local")]);
  return { existing: { ...base, ...local }, local };
}

/** Do not persist process.env: it can contain unrelated machine credentials. */
async function writeEnvironment(workspace, environment, local, runtime) {
  const target = path.join(workspace, ".env.local");
  const temporary = path.join(workspace, `.env.${randomBytes(12).toString("hex")}.local`);
  try {
    await fs.writeFile(temporary, serializeEnvironment({ ...local, ...environment }), { mode: 0o600, flag: "wx" });
    await runtime.secureFile(temporary);
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

/** Runtime injection keeps tests away from Docker, real databases, builds and Auth. */
export function createSetupSystem({ workspace, runtime, processEnvironment = process.env }) {
  let status = { stage: "idle", message: STAGES.idle, busy: false, prepared: false, existingData: false, mode: null, developmentOnly: false, error: null };
  let configuration;
  let child;
  let closed = false;
  const update = (stage, patch = {}) => { status = { ...status, stage, message: STAGES[stage], ...patch }; };
  const snapshot = () => ({ ...status });
  const ensureOpen = () => { if (closed) throw new SetupError("หน้าติดตั้งนี้ปิดแล้ว กรุณาเริ่มใหม่", 409); };
  const runNpm = async (script, env) => {
    if (!processEnvironment.npm_execpath) throw new SetupError("กรุณาเริ่มตัวติดตั้งด้วย npm run setup:system", 500);
    await runtime.run(process.execPath, [processEnvironment.npm_execpath, "run", script], { cwd: workspace, env: { ...processEnvironment, ...env } });
  };

  async function prepare(input) {
    ensureOpen();
    if (status.busy || child) throw new SetupError("กำลังดำเนินการอยู่ กรุณารอสักครู่", 409);
    status = { ...status, busy: true, prepared: false, error: null };
    configuration = undefined;
    try {
      const { existing, local } = await readEnvironment(workspace);
      const env = setupEnvironment(input, existing, runtime.randomSecret);
      update(input.mode === "local" ? "docker" : "checking", { mode: input.mode, developmentOnly: env.NODE_ENV === "development", existingData: false });
      const childEnv = { ...processEnvironment, ...env };
      if (input.mode === "local") {
        await runtime.ensureDocker(childEnv);
        ensureOpen();
        await runtime.run("docker", ["compose", "-f", path.join(workspace, "docker-compose.local.yml"), "up", "-d", "--wait", "db"], { cwd: workspace, env: childEnv });
      }
      ensureOpen();
      update("checking");
      const inspection = await runtime.inspectDatabase(env.DATABASE_URL);
      if (env.DIRECT_URL !== env.DATABASE_URL) {
        const directInspection = await runtime.inspectDatabase(env.DIRECT_URL);
        if (directInspection.existingData !== inspection.existingData || directInspection.database !== inspection.database) {
          throw new SetupError("Database URL และ Direct URL ต้องเชื่อมต่อฐานข้อมูลเดียวกัน");
        }
      }
      ensureOpen();
      const priorSecret = input.appSecret || existing.APP_SECRET || existing.LOCAL_APP_SECRET;
      if (inspection.existingData && (!priorSecret || priorSecret.length < 32)) {
        throw new SetupError("ฐานข้อมูลนี้มีข้อมูลเดิม ต้องระบุ APP_SECRET เดิมของระบบอย่างน้อย 32 ตัวอักษร ไม่ควรสร้างค่าใหม่เพราะจะอ่านข้อมูลที่เข้ารหัสไม่ได้");
      }
      if (env.NODE_ENV === "production") {
        update("auth");
        await runtime.inspectAuth(env);
        ensureOpen();
      }
      update("saving", { existingData: inspection.existingData });
      await writeEnvironment(workspace, env, local, runtime);
      if (!inspection.existingData) {
        update("migrating");
        await runNpm("db:migrate", env);
        ensureOpen();
        update("seeding");
        await runNpm("db:seed", env);
      }
      ensureOpen();
      configuration = env;
      update("prepared", { prepared: true, error: null });
      if (inspection.existingData) status.message = "เชื่อมต่อฐานข้อมูลเดิมแล้ว เก็บข้อมูลเดิมไว้โดยไม่เตรียมโครงสร้างหรือข้อมูลเริ่มต้นซ้ำ";
      return { ...snapshot(), busy: false };
    } catch (error) {
      const message = error instanceof SetupError ? error.message : failureMessage(status.stage);
      status = { ...status, error: message, prepared: false };
      throw new SetupError(message, error instanceof SetupError ? error.status : 500);
    } finally { status = { ...status, busy: false }; }
  }

  async function launch() {
    ensureOpen();
    if (status.busy) throw new SetupError("กำลังดำเนินการอยู่ กรุณารอสักครู่", 409);
    if (status.stage === "ready" && status.url) return snapshot();
    if (!configuration || !status.prepared) throw new SetupError("กรุณาตรวจและเตรียมฐานข้อมูลก่อนเปิดระบบ", 409);
    status = { ...status, busy: true, error: null };
    try {
      const env = configuration;
      await runtime.assertPortAvailable(Number(env.PORT));
      if (!status.developmentOnly) {
        update("building");
        await runNpm("build", env);
      }
      ensureOpen();
      update("launching");
      if (!processEnvironment.npm_execpath) throw new SetupError("กรุณาเริ่มตัวติดตั้งด้วย npm run setup:system", 500);
      child = await runtime.start(process.execPath, [processEnvironment.npm_execpath, "run", status.developmentOnly ? "dev" : "start"], {
        cwd: workspace, env: { ...processEnvironment, ...env },
      });
      const origin = `http://127.0.0.1:${env.PORT}`;
      await runtime.waitReady(origin, child);
      ensureOpen();
      update("ready", { url: `${origin}/setup#install=${encodeURIComponent(env.PUMPPOS_INSTALLATION_CODE)}` });
      return { ...snapshot(), busy: false };
    } catch (error) {
      if (child) await runtime.stop(child);
      child = undefined;
      const message = error instanceof SetupError ? error.message : failureMessage(status.stage);
      status = { ...status, error: message };
      throw new SetupError(message, 500);
    } finally { status = { ...status, busy: false }; }
  }

  async function close() {
    closed = true;
    if (child) await runtime.stop(child);
    child = undefined;
    await runtime.close?.();
  }
  return { prepare, launch, close, snapshot };
}

function failureMessage(stage) {
  return {
    docker: "เปิด PostgreSQL ไม่สำเร็จ กรุณาติดตั้งหรือเปิด Docker Desktop แล้วลองใหม่ ไม่ต้องลบข้อมูลเดิม",
    checking: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาตรวจ URL รหัสผ่าน เครือข่าย และสิทธิ์ของฐานข้อมูล",
    auth: "เชื่อมต่อบัญชีผู้ใช้ Supabase ไม่สำเร็จ กรุณาตรวจ Project URL ทั้งสอง key และการเชื่อมต่ออินเทอร์เน็ต",
    saving: "บันทึกค่าติดตั้งไม่ได้ กรุณาตรวจสิทธิ์เขียนโฟลเดอร์โปรแกรม",
    migrating: "เตรียมโครงสร้างฐานข้อมูลไม่สำเร็จ กรุณาตรวจ Direct URL และสิทธิ์ฐานข้อมูล แล้วลองใหม่",
    seeding: "เตรียมข้อมูลเริ่มต้นไม่สำเร็จ ข้อมูลที่มีอยู่ยังถูกเก็บไว้ กรุณาตรวจฐานข้อมูลก่อนลองใหม่",
    building: "เตรียมโปรแกรมไม่สำเร็จ กรุณาตรวจการติดตั้ง Node.js และ dependencies ของโปรแกรม",
    launching: "เปิดระบบไม่สำเร็จ กรุณาตรวจพอร์ตที่เลือกและค่าฐานข้อมูล แล้วลองใหม่",
  }[stage] || "ดำเนินการไม่สำเร็จ กรุณาตรวจการติดตั้งแล้วลองใหม่";
}

function command(commandName, args, options) {
  return spawn(commandName, args, { ...options, shell: false, windowsHide: true, stdio: "ignore" });
}

function finished(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Setup subprocess failed")));
  });
}

export function createRealRuntime({ postgresFactory, supabaseFactory, fetcher = globalThis.fetch, processSpawner = command } = {}) {
  const ownedProcesses = new Set();
  function startOwned(name, args, options) {
    const child = processSpawner(name, args, { ...options, detached: process.platform !== "win32" });
    ownedProcesses.add(child);
    child.once("exit", () => ownedProcesses.delete(child));
    child.once("error", () => ownedProcesses.delete(child));
    return child;
  }
  const runtime = {
    randomSecret: () => randomBytes(32).toString("base64url"),
    ensureDocker: ensureDockerEngine,
    run: (name, args, options) => finished(startOwned(name, args, options)),
    start: async (name, args, options) => {
      const child = startOwned(name, args, options);
      child.on("error", () => {});
      return child;
    },
    secureFile: async file => {
      await fs.chmod(file, 0o600);
      if (process.platform === "win32") {
        const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : process.env.USERNAME;
        if (!user) throw new Error("Cannot determine current file owner");
        await finished(command("icacls", [file, "/inheritance:r", "/grant:r", `${user}:(F)`, "SYSTEM:(F)"], {}));
      }
    },
    inspectDatabase: async connectionUrl => {
      const postgres = postgresFactory ?? (await import("postgres")).default;
      const url = new URL(connectionUrl);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      const sql = postgres(connectionUrl, { prepare: false, max: 1, connect_timeout: 8, idle_timeout: 2, ssl: loopback ? false : { rejectUnauthorized: true }, onnotice: () => {} });
      try {
        return await sql.begin("read only", async tx => {
          await tx`SET LOCAL statement_timeout = '8000ms'`;
          const [database] = await tx`SELECT current_database() AS name`;
          const tables = await tx`SELECT table_name FROM information_schema.tables WHERE table_schema = 'pos' AND table_type = 'BASE TABLE'`;
          for (const table of tables) {
            const [row] = await tx`SELECT EXISTS (SELECT 1 FROM pos.${tx(table.table_name)} LIMIT 1) AS populated`;
            if (row.populated) return { database: database.name, existingData: true };
          }
          return { database: database.name, existingData: false };
        });
      } finally { await sql.end({ timeout: 3 }); }
    },
    inspectAuth: async environment => {
      const createClient = supabaseFactory ?? (await import("@supabase/supabase-js")).createClient;
      const client = createClient(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, options) => fetcher(input, { ...options, signal: AbortSignal.timeout(10_000) }) },
      });
      const { error } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (error) throw new Error("Private Auth configuration is unavailable");
      const response = await fetcher(`${environment.SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: environment.SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      if (!response.ok) throw new Error("Public Auth configuration is unavailable");
    },
    assertPortAvailable: port => new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () => reject(new SetupError("พอร์ตระบบถูกใช้อยู่ กรุณาเลือกพอร์ตอื่นแล้วตรวจฐานข้อมูลอีกครั้ง", 409)));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    }),
    waitReady: async (origin, child) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (child.exitCode !== null || child.killed) throw new Error("Server exited before ready");
        try {
          const response = await fetcher(`${origin}/api/trpc/initialSetup.state`, { signal: AbortSignal.timeout(1500), redirect: "error", cache: "no-store" });
          if (response.ok) {
            const result = await response.json();
            const state = result.result?.data?.json ?? result.result?.data;
            if (state?.systemReady === true) return;
            if (state?.systemReady === false) throw new SetupError("ระบบเปิดได้ แต่ค่าติดตั้งหรือโครงสร้างฐานข้อมูลยังไม่พร้อม กรุณาตรวจฐานข้อมูลเดิมและค่าบัญชีผู้ใช้ก่อนเปิดระบบ", 409);
          }
        } catch (error) { if (error instanceof SetupError) throw error; /* Server may still be starting. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error("Server readiness timed out");
    },
    stop: async child => {
      if (child.exitCode !== null || child.signalCode != null) return;
      if (process.platform === "win32") {
        // npm owns another Node child; terminate only this installer-owned process tree.
        await finished(command("taskkill", ["/PID", String(child.pid), "/T", "/F"], {})).catch(() => {});
      } else {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      }
    },
    close: async () => {
      await Promise.allSettled([...ownedProcesses].map(child => runtime.stop(child)));
    },
  };
  return runtime;
}

async function requestBody(request) {
  if (!/^application\/json(?:\s*;.*)?$/iu.test(request.headers["content-type"] || "")) throw new SetupError("รูปแบบคำขอไม่ถูกต้อง", 415);
  if (Number(request.headers["content-length"] || 0) > MAX_BODY) throw new SetupError("คำขอมีขนาดใหญ่เกินไป", 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new SetupError("คำขอมีขนาดใหญ่เกินไป", 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body;
  } catch { throw new SetupError("รูปแบบคำขอไม่ถูกต้อง"); }
}

function tokenMatches(value, expected) {
  if (typeof value !== "string") return false;
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Loopback only; cross-origin pages cannot read the token or submit commands. */
export async function createWizardServer(system, { token = randomBytes(32).toString("base64url") } = {}) {
  let origin;
  const server = http.createServer(async (request, response) => {
    const send = (status, value, type = "application/json; charset=utf-8") => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", "pragma": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", "x-frame-options": "DENY", "content-security-policy": `default-src 'none'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` });
      response.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
    };
    try {
      if (request.headers.host !== new URL(origin).host || !["127.0.0.1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) throw new SetupError("ไม่อนุญาตคำขอจากที่อยู่นี้", 403);
      const incomingOrigin = request.headers.origin;
      const referer = request.headers.referer;
      if ((incomingOrigin && incomingOrigin !== origin) || (referer && new URL(referer).origin !== origin) || ["cross-site", "same-site"].includes(request.headers["sec-fetch-site"])) throw new SetupError("ไม่อนุญาตคำขอจากหน้าอื่น", 403);
      if (request.method === "GET" && request.url === "/") return send(200, wizardHtml(token), "text/html; charset=utf-8");
      if (!tokenMatches(request.headers["x-setup-token"], token)) throw new SetupError("กรุณาเปิดหน้าติดตั้งจากลิงก์ในเครื่องนี้ใหม่", 403);
      if (request.method === "GET" && request.url === "/status") return send(200, system.snapshot());
      if (request.method !== "POST" || incomingOrigin !== origin) throw new SetupError("ไม่อนุญาตคำขอนี้", 403);
      if (!["/prepare", "/launch"].includes(request.url)) throw new SetupError("ไม่พบคำขอนี้", 404);
      const body = await requestBody(request);
      const value = request.url === "/prepare" ? await system.prepare(body) : await system.launch();
      return send(200, value);
    } catch (error) {
      const safe = error instanceof SetupError ? error : new SetupError("ดำเนินการไม่สำเร็จ กรุณาเปิดหน้าติดตั้งใหม่", 500);
      return send(safe.status, { error: safe.message });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, close: async () => {
    await system.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

function wizardHtml(token) {
  return `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ติดตั้ง PumpPOS</title>
<style nonce="${token}">*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#f3f6fb;color:#17314b;margin:0;padding:24px}main{max-width:760px;margin:24px auto;background:white;border-radius:20px;padding:32px;box-shadow:0 12px 48px #17314b12}h1{margin-top:0;font-size:28px}p{line-height:1.7}.choices{display:grid;grid-template-columns:1fr 1fr;gap:12px}.choice{border:1px solid #cbd5e1;border-radius:12px;padding:16px;cursor:pointer}label{display:block;margin:16px 0 6px}input[type=text],input[type=password],input[type=number]{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}button{font:inherit;padding:13px 20px;border:0;border-radius:10px;background:#125cc7;color:white;cursor:pointer;margin-top:16px}button:disabled{opacity:.45;cursor:wait}.note{font-size:14px;color:#4b647e}.status{padding:16px;background:#eff6ff;border-radius:10px;white-space:pre-line}#error{color:#b91c1c;white-space:pre-line}[hidden]{display:none!important}@media(max-width:560px){main{padding:20px}.choices{grid-template-columns:1fr}body{padding:10px}}</style>
<main><h1>ติดตั้งระบบก่อนเริ่มใช้งาน</h1><p>เลือกฐานข้อมูล ตรวจการเชื่อมต่อ แล้วตั้งค่าเจ้าของร้านและข้อมูลร้านในขั้นตอนถัดไป ค่าลับจะบันทึกในไฟล์ส่วนตัวของเครื่องนี้ ไม่เก็บในเบราว์เซอร์</p>
<form id="form" autocomplete="off"><div class="choices"><label class="choice"><input type="radio" name="mode" value="supabase" checked> <strong>Supabase</strong><br><span class="note">ฐานข้อมูลและบัญชีผู้ใช้บนคลาวด์ ใช้งานจริงผ่านระบบที่ตรวจสิทธิ์ผู้ใช้</span></label><label class="choice"><input type="radio" name="mode" value="local"> <strong>PostgreSQL ในเครื่อง</strong><br><span class="note">เก็บฐานข้อมูลในเครื่องผ่าน Docker ใช้ Supabase สำหรับบัญชีผู้ใช้และการเข้าสู่ระบบ</span></label></div>
<section id="local" hidden><p>ต้องติดตั้ง Docker Desktop และเปิดใช้งานไว้ ข้อมูลจะเก็บบน volume เดิมของ Docker โดยไม่ลบฐานข้อมูลเดิม การเข้าสู่ระบบผ่าน Supabase ยังต้องใช้อินเทอร์เน็ต</p><label for="postgresPort">พอร์ต PostgreSQL</label><input id="postgresPort" type="number" min="1024" max="65535" value="54329"><label for="postgresPassword">รหัสผ่าน PostgreSQL เดิม (เฉพาะเครื่องที่มีฐานข้อมูลอยู่แล้ว)</label><input id="postgresPassword" type="password" maxlength="8192" placeholder="เว้นว่างเพื่อใช้ค่าที่บันทึกไว้ หรือสร้างรหัสใหม่สำหรับฐานข้อมูลใหม่"><label><input id="developmentOnly" type="checkbox"> โหมดพัฒนาและทดสอบ (ไม่ใช้ Supabase Auth)</label><p class="note">ตัวเลือกนี้เปิดระบบพัฒนาในเครื่อง ไม่มีการยืนยันตัวตนสำหรับใช้งานจริง ใช้กับข้อมูลทดสอบเท่านั้น</p></section>
<section id="authentication"><label><input id="useSaved" type="checkbox"> ใช้ค่าติดตั้ง Supabase ที่เคยบันทึกในเครื่องนี้</label><div id="cloudFields"><section id="cloud"><label for="databaseUrl">Database URL</label><input id="databaseUrl" type="password" spellcheck="false" placeholder="postgresql://..." maxlength="8192"><p class="note">คัดลอกจากหน้า Connect ของโปรเจกต์ ใช้ Direct connection หรือ Session pooler และฐานข้อมูลแยกสำหรับธุรกิจนี้</p><label for="directUrl">Direct URL สำหรับเตรียมโครงสร้าง (ไม่บังคับ)</label><input id="directUrl" type="password" spellcheck="false" placeholder="เว้นว่างเพื่อใช้ Database URL" maxlength="8192"></section><label for="supabaseUrl">Supabase Project URL</label><input id="supabaseUrl" type="text" spellcheck="false" placeholder="https://your-project.supabase.co" maxlength="8192"><label for="publishableKey">Publishable key</label><input id="publishableKey" type="password" spellcheck="false" placeholder="sb_publishable_..." maxlength="8192"><label for="secretKey">Secret key สำหรับเซิร์ฟเวอร์</label><input id="secretKey" type="password" spellcheck="false" placeholder="sb_secret_..." maxlength="8192"></div></section>
<label for="appPort">พอร์ตเปิดระบบ</label><input id="appPort" type="number" min="1024" max="65535" value="3010"><label for="appSecret">APP_SECRET เดิม (เฉพาะการเชื่อมต่อฐานข้อมูลธุรกิจที่มีอยู่แล้ว)</label><input id="appSecret" type="password" maxlength="8192" placeholder="เว้นว่างเพื่อใช้ค่าที่บันทึกไว้ หรือสร้างค่าลับสำหรับระบบใหม่"><p class="note">หากพบข้อมูลเดิม ระบบจะบันทึกการเชื่อมต่อและข้ามการสร้างโครงสร้างหรือข้อมูลเริ่มต้น การอัปเกรดฐานข้อมูลเดิมต้องทำผ่านขั้นตอนดูแลระบบ</p><button id="prepare" type="submit">เชื่อมต่อและเตรียมฐานข้อมูล</button></form>
<p id="status" class="status" role="status">${STAGES.idle}</p><p id="error" role="alert"></p><button id="launch" type="button" hidden>เปิดระบบและตั้งค่าร้าน</button><p class="note">เปิดหน้าติดตั้งนี้ไว้ระหว่างใช้งาน หากต้องการหยุดระบบ กด Ctrl+C ในหน้าต่างคำสั่ง</p></main>
<script nonce="${token}">
const token=${JSON.stringify(token)};
const form=document.getElementById('form');
const status=document.getElementById('status');
const error=document.getElementById('error');
const launch=document.getElementById('launch');
let busy=false;
function mode(){return form.elements.mode.value}
function development(){return mode()==='local'&&document.getElementById('developmentOnly').checked}
function render(s){status.textContent=s.message||'';error.textContent=s.error||'';launch.hidden=!s.prepared;launch.disabled=busy||s.busy;document.getElementById('prepare').disabled=busy||s.busy;}
function visibility(){document.getElementById('cloud').hidden=mode()!=='supabase';document.getElementById('local').hidden=mode()!=='local';document.getElementById('authentication').hidden=development();document.getElementById('cloudFields').hidden=document.getElementById('useSaved').checked;}
form.addEventListener('change',visibility);
async function call(route,body){const response=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-setup-token':token},body:JSON.stringify(body),cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'ดำเนินการไม่สำเร็จ');return result;}
async function perform(fn){busy=true;form.querySelectorAll('input,button').forEach(i=>i.disabled=true);launch.disabled=true;error.textContent='';try{await fn();}catch(e){error.textContent=e.message;}finally{busy=false;form.querySelectorAll('input,button').forEach(i=>i.disabled=false);launch.disabled=false;}}
form.addEventListener('submit',event=>{
  event.preventDefault();if(busy)return;
  const body={mode:mode(),developmentOnly:development(),useSaved:document.getElementById('useSaved').checked,appPort:document.getElementById('appPort').value,postgresPort:document.getElementById('postgresPort').value,postgresPassword:document.getElementById('postgresPassword').value,appSecret:document.getElementById('appSecret').value};
  if(!body.developmentOnly&&!body.useSaved){for(const key of ['supabaseUrl','publishableKey','secretKey'])body[key]=document.getElementById(key).value;if(body.mode==='supabase'){for(const key of ['databaseUrl','directUrl'])body[key]=document.getElementById(key).value;}}
  void perform(async()=>{const result=await call('/prepare',body);for(const key of ['databaseUrl','directUrl','publishableKey','secretKey','postgresPassword','appSecret'])document.getElementById(key).value='';document.getElementById('useSaved').checked=!body.developmentOnly;visibility();render(result);});
});
launch.addEventListener('click',()=>{if(busy)return;void perform(async()=>{const result=await call('/launch',{});render(result);if(result.url)location.replace(result.url);});});
setInterval(async()=>{if(!busy)return;try{const response=await fetch('/status',{headers:{'x-setup-token':token},cache:'no-store'});if(response.ok)render(await response.json());}catch{}},1000);
visibility();
</script></html>`;
}

function openBrowser(url) {
  const name = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = command(name, args, {});
  child.on("error", () => {});
  child.unref();
}

async function main() {
  const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const system = createSetupSystem({ workspace, runtime: createRealRuntime() });
  const wizard = await createWizardServer(system);
  // Only the public wizard address is printed, never the installation code or credentials.
  console.log(`เปิดหน้าติดตั้งระบบ: ${wizard.origin}`);
  console.log("หยุดระบบและหน้าติดตั้งด้วย Ctrl+C");
  if (!process.argv.includes("--no-open")) openBrowser(wizard.origin);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await wizard.close();
    process.exit(0);
  };
  process.on("SIGINT", () => { void close(); });
  process.on("SIGTERM", () => { void close(); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("เปิดหน้าติดตั้งไม่ได้ กรุณาตรวจ Node.js และรัน npm run setup:system อีกครั้ง");
    process.exitCode = 1;
  });
}
