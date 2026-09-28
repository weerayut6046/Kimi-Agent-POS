import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { parse } from "dotenv";
import {
  createRealRuntime,
  createSetupSystem,
  createWizardServer,
  serializeEnvironment,
  setupEnvironment,
} from "./setup-system.mjs";

const project = "testprojectref";
const cloud = {
  mode: "supabase",
  databaseUrl: `postgresql://postgres.${project}:private-db-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  directUrl: `postgresql://postgres:private-db-password@db.${project}.supabase.co:5432/postgres?sslmode=verify-full`,
  supabaseUrl: `https://${project}.supabase.co`,
  publishableKey: "sb_publishable_testpublicvalue123",
  secretKey: "sb_secret_privateservervalue123",
};
const secret = "previous-value-".repeat(3);
const generated = "generated-value-".repeat(3);
const temporaryDirectories: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of temporaryDirectories.splice(0)) {
    // Only exact directories created by this test are removed.
    if (!directory.startsWith(path.join(os.tmpdir(), "pumppos-setup-test-"))) throw new Error("Unexpected test directory");
    await fs.rm(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

async function fixture(existing: Record<string, string> = {}, populated = false) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pumppos-setup-test-"));
  temporaryDirectories.push(workspace);
  if (Object.keys(existing).length) await fs.writeFile(path.join(workspace, ".env.local"), serializeEnvironment(existing));
  const runtime = {
    randomSecret: vi.fn(() => generated),
    ensureDocker: vi.fn(async () => {}),
    inspectDatabase: vi.fn(async () => ({ database: "postgres", existingData: populated })),
    inspectAuth: vi.fn(async () => {}),
    run: vi.fn(async () => {}),
    secureFile: vi.fn(async () => {}),
    start: vi.fn(async () => ({ pid: 12345, exitCode: null, killed: false })),
    waitReady: vi.fn(async () => {}),
    assertPortAvailable: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const system = createSetupSystem({ workspace, runtime, processEnvironment: { npm_execpath: "C:\\npm\\npm-cli.js", MACHINE_PRIVATE_VALUE: "must-not-be-saved" } });
  closers.push(system.close);
  const read = async () => parse(await fs.readFile(path.join(workspace, ".env.local")));
  return { workspace, runtime, system, read };
}

function legacyKey(role: string) {
  return `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
}

describe("installer configuration", () => {
  it("keeps existing server secrets and unrelated values, but exposes only the public Supabase key", () => {
    const env = setupEnvironment(cloud, { APP_SECRET: secret, PUMPPOS_INSTALLATION_CODE: secret, PAYMENT_PROVIDER_SECRET: "keep-private", VITE_SUPABASE_SECRET_KEY: "unsafe-old-value" }, () => generated);
    expect(env.APP_SECRET).toBe(secret);
    expect(env.PUMPPOS_INSTALLATION_CODE).toBe(secret);
    expect(env.PAYMENT_PROVIDER_SECRET).toBe("keep-private");
    expect(env.VITE_SUPABASE_SECRET_KEY).toBe("");
    expect(env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(cloud.publishableKey);
    expect(Object.entries(env).filter(([key]) => key.startsWith("VITE_")).some(([, value]) => value === cloud.secretKey)).toBe(false);
    expect(env).toMatchObject({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "false", VITE_LOCAL_AUTH_ENABLED: "false", VITE_API_TRANSPORT: "node" });
    expect(parse(serializeEnvironment(env))).toEqual(env);
  });

  it("preserves the effective previous local application encryption secret", () => {
    const env = setupEnvironment({ mode: "local", developmentOnly: true }, { LOCAL_APP_SECRET: secret, LOCAL_POSTGRES_PASSWORD: "old-database-password" }, () => generated);
    expect(env.APP_SECRET).toBe(secret);
    expect(env.DATABASE_URL).toContain("old-database-password");
  });

  it.each(["databaseUrl", "directUrl"])("rejects a %s from another Supabase project before any work", key => {
    const value = key === "databaseUrl" ? "postgresql://postgres.otherproject:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres" : "postgresql://postgres:pw@db.otherproject.supabase.co:5432/postgres";
    expect(() => setupEnvironment({ ...cloud, [key]: value })).toThrow("โปรเจกต์ Supabase เดียวกัน");
  });

  it("rejects credential leakage through the public key field, including legacy service_role JWTs", () => {
    expect(() => setupEnvironment({ ...cloud, publishableKey: cloud.secretKey })).toThrow("แยก Publishable");
    expect(() => setupEnvironment({ ...cloud, publishableKey: legacyKey("service_role") })).toThrow("แยก Publishable");
    expect(() => setupEnvironment({ ...cloud, secretKey: legacyKey("anon") })).toThrow("แยก Publishable");
    const env = setupEnvironment({ ...cloud, publishableKey: legacyKey("anon"), secretKey: legacyKey("service_role") });
    expect(env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(legacyKey("anon"));
  });

  it("uses production Auth by default for a local database and permits development only explicitly", () => {
    expect(() => setupEnvironment({ mode: "local" })).toThrow("Supabase URL");
    const local = setupEnvironment({ ...cloud, mode: "local" });
    expect(local).toMatchObject({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "false", VITE_LOCAL_AUTH_ENABLED: "false", SUPABASE_DB_URL: "", SUPABASE_URL: cloud.supabaseUrl });
    expect(new URL(local.DATABASE_URL).hostname).toBe("127.0.0.1");
    const development = setupEnvironment({ mode: "local", developmentOnly: true });
    expect(development).toMatchObject({ NODE_ENV: "development", LOCAL_AUTH_ENABLED: "true", VITE_LOCAL_AUTH_ENABLED: "true", SUPABASE_SECRET_KEY: "" });
    const supabase = setupEnvironment({ ...cloud, developmentOnly: true });
    expect(supabase.LOCAL_AUTH_ENABLED).toBe("false");
  });

  it("rejects unsafe protocol, TLS downgrade, invalid ports, and application-secret replacement", () => {
    expect(() => setupEnvironment({ ...cloud, supabaseUrl: "http://testprojectref.supabase.co" })).toThrow("HTTPS");
    expect(() => setupEnvironment({ ...cloud, databaseUrl: cloud.databaseUrl.replace("verify-full", "disable") })).toThrow("ปลอดภัย");
    expect(() => setupEnvironment({ mode: "local", developmentOnly: true, appPort: "54329" })).toThrow("ต้องต่างกัน");
    expect(() => setupEnvironment({ ...cloud, appPort: "3010;whoami" })).toThrow("พอร์ต");
    expect(() => setupEnvironment({ ...cloud, appSecret: generated }, { APP_SECRET: secret })).toThrow("ค่าเดิม");
  });
});

describe("installer workflow with no external services", () => {
  it("probes both database connections and Auth before saving, migrating and seeding a fresh project", async () => {
    const { system, runtime, read } = await fixture({ EXISTING_FEATURE: "preserved" });
    const result = await system.prepare(cloud);
    expect(result).toMatchObject({ prepared: true, existingData: false, busy: false });
    expect(runtime.inspectDatabase.mock.calls.map(call => call[0])).toEqual([cloud.databaseUrl, cloud.directUrl]);
    expect(runtime.inspectAuth).toHaveBeenCalledOnce();
    expect(runtime.ensureDocker).not.toHaveBeenCalled();
    expect(runtime.run.mock.calls.map(call => call[1])).toEqual([["C:\\npm\\npm-cli.js", "run", "db:migrate"], ["C:\\npm\\npm-cli.js", "run", "db:seed"]]);
    const env = await read();
    expect(env).toMatchObject({ EXISTING_FEATURE: "preserved", APP_SECRET: generated, PUMPPOS_INSTALLATION_CODE: generated });
    expect(env.MACHINE_PRIVATE_VALUE).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(cloud.secretKey);
    expect(JSON.stringify(result)).not.toContain(cloud.databaseUrl);
    expect(JSON.stringify(result)).not.toContain(generated);
    expect(runtime.inspectAuth.mock.invocationCallOrder[0]).toBeLessThan(runtime.secureFile.mock.invocationCallOrder[0]);
    expect(runtime.secureFile.mock.invocationCallOrder[0]).toBeLessThan(runtime.run.mock.invocationCallOrder[0]);
  });

  it("connects a populated database without running migrations or seed, preserving its original secret", async () => {
    const { system, runtime, read } = await fixture({ LOCAL_APP_SECRET: secret, OLD_SETTING: "kept" }, true);
    const result = await system.prepare(cloud);
    expect(result).toMatchObject({ prepared: true, existingData: true });
    expect(runtime.run).not.toHaveBeenCalled();
    expect(await read()).toMatchObject({ APP_SECRET: secret, LOCAL_APP_SECRET: secret, OLD_SETTING: "kept" });
  });

  it.each([{}, { APP_SECRET: "too-short" }])("does not create or rotate the encryption key for an existing business: %j", async existing => {
    const { system, runtime, workspace } = await fixture(existing, true);
    await expect(system.prepare(cloud)).rejects.toThrow("APP_SECRET เดิม");
    expect(runtime.secureFile).not.toHaveBeenCalled();
    expect(runtime.run).not.toHaveBeenCalled();
    if (Object.keys(existing).length) expect(parse(await fs.readFile(path.join(workspace, ".env.local")))).toEqual(existing);
    else await expect(fs.stat(path.join(workspace, ".env.local"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires successful DB and Auth probes and keeps all raw credential errors private", async () => {
    const { system, runtime, read } = await fixture({ APP_SECRET: secret });
    const raw = `${cloud.secretKey} ${cloud.databaseUrl} sensitive-user-email@example.test`;
    runtime.inspectDatabase.mockRejectedValueOnce(new Error(raw));
    await expect(system.prepare(cloud)).rejects.toThrow("เชื่อมต่อฐานข้อมูลไม่สำเร็จ");
    expect(runtime.inspectAuth).not.toHaveBeenCalled();
    expect(await read()).toEqual({ APP_SECRET: secret });
    runtime.inspectAuth.mockRejectedValueOnce(new Error(raw));
    await expect(system.prepare(cloud)).rejects.toThrow("บัญชีผู้ใช้ Supabase ไม่สำเร็จ");
    expect(JSON.stringify(system.snapshot())).not.toContain(raw);
    expect(runtime.secureFile).not.toHaveBeenCalled();
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("stops when database and direct inspections disagree", async () => {
    const { system, runtime } = await fixture({ APP_SECRET: secret });
    runtime.inspectDatabase.mockResolvedValueOnce({ database: "postgres", existingData: false }).mockResolvedValueOnce({ database: "other", existingData: false });
    await expect(system.prepare(cloud)).rejects.toThrow("ฐานข้อมูลเดียวกัน");
    expect(runtime.secureFile).not.toHaveBeenCalled();
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it.each([false, true])("starts local Docker safely, then uses the intended runtime (developmentOnly=%s)", async developmentOnly => {
    const { system, runtime } = await fixture({ APP_SECRET: secret, LOCAL_POSTGRES_PASSWORD: "keep-existing-password" });
    await system.prepare({ ...cloud, mode: "local", developmentOnly });
    expect(runtime.ensureDocker).toHaveBeenCalledOnce();
    expect(runtime.run.mock.calls[0][0]).toBe("docker");
    expect(runtime.run.mock.calls[0][1]).toEqual(["compose", "-f", expect.stringContaining("docker-compose.local.yml"), "up", "-d", "--wait", "db"]);
    expect(runtime.inspectAuth).toHaveBeenCalledTimes(developmentOnly ? 0 : 1);
    await system.launch();
    expect(runtime.start.mock.calls[0][1]).toEqual(["C:\\npm\\npm-cli.js", "run", developmentOnly ? "dev" : "start"]);
    const env = runtime.start.mock.calls[0][2].env;
    expect(env.NODE_ENV).toBe(developmentOnly ? "development" : "production");
    expect(env.LOCAL_AUTH_ENABLED).toBe(developmentOnly ? "true" : "false");
    expect(runtime.run.mock.calls.some(call => call[1].at(-1) === "build")).toBe(!developmentOnly);
  });

  it("builds Supabase production first and returns the installation proof only in the launch fragment", async () => {
    const { system, runtime } = await fixture();
    await system.prepare(cloud);
    const result = await system.launch();
    expect(runtime.run.mock.calls.at(-1)?.[1].at(-1)).toBe("build");
    expect(runtime.start.mock.calls[0][2].env).toMatchObject({ NODE_ENV: "production", LOCAL_AUTH_ENABLED: "false", BIND_HOST: "127.0.0.1" });
    expect(result.url).toBe(`http://127.0.0.1:3010/setup#install=${generated}`);
    expect(new URL(result.url).search).toBe("");
    await system.close();
    expect(runtime.stop).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("holds concurrent actions and never launches after prepare fails", async () => {
    const { system, runtime } = await fixture();
    let release!: () => void;
    runtime.inspectDatabase.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ database: "postgres", existingData: false }); }));
    const pending = system.prepare(cloud);
    await vi.waitFor(() => expect(runtime.inspectDatabase).toHaveBeenCalledOnce());
    await expect(system.prepare(cloud)).rejects.toMatchObject({ status: 409 });
    await expect(system.launch()).rejects.toMatchObject({ status: 409 });
    release();
    await pending;
    runtime.inspectDatabase.mockRejectedValueOnce(new Error("private-db-error"));
    await expect(system.prepare(cloud)).rejects.toThrow();
    await expect(system.launch()).rejects.toThrow("เตรียมฐานข้อมูลก่อน");
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("invokes owned process cleanup during prepare and prevents continuing after the installer closes", async () => {
    const { system, runtime } = await fixture();
    let release!: () => void;
    runtime.run.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = system.prepare(cloud);
    await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
    await system.close();
    expect(runtime.close).toHaveBeenCalledOnce();
    release();
    await expect(pending).rejects.toThrow("หน้าติดตั้งนี้ปิดแล้ว");
    expect(runtime.run).toHaveBeenCalledOnce();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("tracks and stops both running commands and the app while leaving unrelated processes alone", async () => {
    const building = new EventEmitter();
    const app = new EventEmitter();
    const unrelated = new EventEmitter();
    const processSpawner = vi.fn().mockReturnValueOnce(building).mockReturnValueOnce(app);
    const runtime = createRealRuntime({ processSpawner });
    const stop = vi.spyOn(runtime, "stop").mockImplementation(async child => { child.emit("exit", 1); });
    const commandResult = runtime.run("node", ["build"], {}).then(() => "success", () => "stopped");
    await runtime.start("node", ["app"], {});
    await runtime.close();
    expect(stop.mock.calls.map(call => call[0])).toEqual([building, app]);
    expect(stop.mock.calls.some(call => call[0] === unrelated)).toBe(false);
    expect(await commandResult).toBe("stopped");
    await runtime.close();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("waits for authoritative setup readiness rather than merely a working HTTP server", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ result: { data: { json: { systemReady: false } } } }), { status: 200 }));
    const runtime = createRealRuntime();
    await expect(runtime.waitReady("http://127.0.0.1:3010", { exitCode: null, killed: false })).rejects.toThrow("โครงสร้างฐานข้อมูลยังไม่พร้อม");
    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:3010/api/trpc/initialSetup.state");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: { json: { systemReady: true } } } }), { status: 200 }));
    await expect(runtime.waitReady("http://127.0.0.1:3010", { exitCode: null, killed: false })).resolves.toBeUndefined();
  });

  it("uses read-only, bounded SQL and quotes every catalog-derived table identifier", async () => {
    const statements: string[] = [];
    const tx = vi.fn((parts: string | TemplateStringsArray, ...values: Array<{ identifier: string }>) => {
      if (typeof parts === "string") return { identifier: parts };
      const statement = parts.reduce((text, part, index) => text + part + (index < values.length ? `"${values[index].identifier.replaceAll('"', '""')}"` : ""), "");
      statements.push(statement);
      if (statement.includes("current_database")) return Promise.resolve([{ name: "postgres" }]);
      if (statement.includes("information_schema")) return Promise.resolve([{ table_name: 'odd"table' }]);
      if (statement.includes("SELECT EXISTS")) return Promise.resolve([{ populated: true }]);
      return Promise.resolve([]);
    });
    const end = vi.fn(async () => {});
    const begin = vi.fn(async (_mode: string, inspect: (transaction: typeof tx) => Promise<unknown>) => inspect(tx));
    const factory = vi.fn(() => ({ begin, end }));
    const runtime = createRealRuntime({ postgresFactory: factory });
    await expect(runtime.inspectDatabase(cloud.databaseUrl)).resolves.toEqual({ database: "postgres", existingData: true });
    expect(factory.mock.calls[0][1]).toMatchObject({ prepare: false, max: 1, ssl: { rejectUnauthorized: true } });
    expect(begin.mock.calls[0][0]).toBe("read only");
    expect(statements).toContain("SET LOCAL statement_timeout = '8000ms'");
    expect(statements).toContain('SELECT EXISTS (SELECT 1 FROM pos."odd""table" LIMIT 1) AS populated');
    expect(end).toHaveBeenCalledOnce();
  });

  it("reads private Auth availability and public settings without exposing either key", async () => {
    const listUsers = vi.fn(async () => ({ error: null }));
    const factory = vi.fn(() => ({ auth: { admin: { listUsers } } }));
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const runtime = createRealRuntime({ supabaseFactory: factory, fetcher });
    const env = setupEnvironment(cloud);
    await runtime.inspectAuth(env);
    expect(factory.mock.calls[0].slice(0, 2)).toEqual([cloud.supabaseUrl, cloud.secretKey]);
    expect(factory.mock.calls[0][2].auth.persistSession).toBe(false);
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1 });
    expect(fetcher.mock.calls[0][0]).toBe(`${cloud.supabaseUrl}/auth/v1/settings`);
    expect(fetcher.mock.calls[0][1].headers.apikey).toBe(cloud.publishableKey);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(cloud.secretKey);
    listUsers.mockResolvedValueOnce({ error: { message: "private-Auth-error" } });
    await expect(runtime.inspectAuth(env)).rejects.toThrow("Private Auth configuration");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("loopback installation HTTP boundary", () => {
  async function serverFixture() {
    const fixtureResult = await fixture();
    const token = "private-local-csrf-token-at-least-32-characters";
    const wizard = await createWizardServer(fixtureResult.system, { token });
    closers.push(wizard.close);
    const post = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${wizard.origin}${route}`, { method: "POST", headers: { "content-type": "application/json", "x-setup-token": token, origin: wizard.origin, ...headers }, body: JSON.stringify(body) });
    return { ...fixtureResult, wizard, token, post };
  }

  it("serves a private, uncacheable page without credentials or browser persistence", async () => {
    const { wizard, token } = await serverFixture();
    const response = await fetch(wizard.origin);
    const html = await response.text();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain(token);
    expect(html).toContain('id="developmentOnly"');
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
    expect(html).not.toContain(cloud.secretKey);
    expect(html).not.toContain(cloud.databaseUrl);
    expect(html).not.toContain(generated);
    expect((await fetch(`${wizard.origin}/status`)).status).toBe(403);
  });

  it("rejects foreign Origin, Referer, Host, missing Origin and invalid proof before any writes", async () => {
    const { runtime, post, wizard, token } = await serverFixture();
    for (const headers of [
      { origin: "https://foreign.example" },
      { referer: "https://foreign.example/page" },
      { origin: "" },
      { "x-setup-token": "wrong" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const response = await post("/prepare", cloud, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
    }
    // Node fetch rewrites Host; use the native client to exercise DNS-rebinding protection.
    const wrongHostStatus = await new Promise<number>((resolve, reject) => {
      const request = http.request(`${wizard.origin}/prepare`, {
        method: "POST", headers: { host: "localhost:9999", origin: wizard.origin, "x-setup-token": token, "content-type": "application/json" },
      }, response => { response.resume(); resolve(response.statusCode || 0); });
      request.on("error", reject);
      request.end(JSON.stringify(cloud));
    });
    expect(wrongHostStatus).toBe(403);
    expect(runtime.inspectDatabase).not.toHaveBeenCalled();
    expect(runtime.secureFile).not.toHaveBeenCalled();
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("bounds requests and redacts DB failure details from status and HTTP responses", async () => {
    const { runtime, post, wizard, token } = await serverFixture();
    const oversized = await post("/prepare", { padding: "a".repeat(33 * 1024) });
    expect(oversized.status).toBe(413);
    expect(runtime.inspectDatabase).not.toHaveBeenCalled();
    runtime.inspectDatabase.mockRejectedValueOnce(new Error(`${cloud.secretKey} ${cloud.databaseUrl}`));
    const failed = await post("/prepare", cloud);
    expect(failed.status).toBe(500);
    const body = await failed.text();
    expect(body).not.toContain(cloud.secretKey);
    expect(body).not.toContain(cloud.databaseUrl);
    const response = await fetch(`${wizard.origin}/status`, { headers: { "x-setup-token": token } });
    expect(await response.text()).not.toContain(cloud.secretKey);
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("accepts only a same-origin, explicitly submitted preparation and launch", async () => {
    const { runtime, post } = await serverFixture();
    const response = await post("/prepare", cloud);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prepared: true, busy: false });
    expect(runtime.start).not.toHaveBeenCalled();
    const launch = await post("/launch", {});
    expect(launch.status).toBe(200);
    expect(await launch.json()).toMatchObject({ stage: "ready", url: `http://127.0.0.1:3010/setup#install=${generated}` });
  });
});
