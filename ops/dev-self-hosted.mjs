import { spawn } from "node:child_process";
import { config } from "dotenv";
import { ensureDockerEngine } from "./docker-runtime.mjs";

config({ path: ".env.local", quiet: true });

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is unavailable; start this runner via npm");
}
const bindToLan = process.argv.includes("--lan");
const appPort = process.env.LOCAL_APP_PORT || "3010";
const postgresPort = process.env.LOCAL_POSTGRES_PORT || "54329";
const postgresPassword =
  process.env.LOCAL_POSTGRES_PASSWORD || "pumppos_dev_only";
const usesExternalDatabase = Boolean(process.env.LOCAL_DATABASE_URL);
const databaseUrl =
  process.env.LOCAL_DATABASE_URL ||
  `postgresql://pumppos:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/pumppos`;

const localEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  SUPABASE_DB_URL: "",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_PUBLISHABLE_KEY: "",
  VITE_USE_SUPABASE_EDGE_API: "false",
  LOCAL_AUTH_ENABLED: "true",
  VITE_LOCAL_AUTH_ENABLED: "true",
  APP_SECRET:
    process.env.LOCAL_APP_SECRET ||
    "pumppos-local-development-session-secret-change-me",
  LOCAL_ADMIN_PASSWORD: process.env.LOCAL_ADMIN_PASSWORD || "DevOnly1234!",
  BIND_HOST: bindToLan ? "0.0.0.0" : "127.0.0.1",
  APP_PORT: appPort,
  PORT: appPort,
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: localEnv,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) resolve();
      else
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function runNpm(args) {
  return run(process.execPath, [npmCli, ...args]);
}

async function main() {
  if (usesExternalDatabase) {
    console.log(">> Using PostgreSQL from LOCAL_DATABASE_URL.");
  } else {
    await ensureDockerEngine(localEnv);
    console.log(">> Starting local PostgreSQL...");
    await run("docker", [
      "compose",
      "-f",
      "docker-compose.local.yml",
      "up",
      "-d",
      "--wait",
      "db",
    ]);
  }

  console.log(">> Applying PostgreSQL migrations...");
  await runNpm(["run", "db:migrate"]);

  console.log(">> Seeding the local database when empty...");
  await runNpm(["run", "db:seed"]);

  console.log(
    bindToLan
      ? `>> Local dev server is available on this machine and your LAN (port ${appPort}).`
      : `>> Local dev server: http://127.0.0.1:${appPort}`
  );
  console.log(">> Login: admin / value of LOCAL_ADMIN_PASSWORD");
  await runNpm(["run", "dev"]);
}

main().catch(error => {
  console.error(">> Self-hosted development startup failed:", error.message);
  process.exit(1);
});
