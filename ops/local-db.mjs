import { spawn } from "node:child_process";
import { config } from "dotenv";
import { ensureDockerEngine } from "./docker-runtime.mjs";

config({ path: ".env.local", quiet: true });

const action = process.argv[2];
const argsByAction = {
  up: ["up", "-d", "--wait", "db"],
  down: ["down"],
  reset: ["down", "-v"],
};
const actionArgs = argsByAction[action];
if (!actionArgs) {
  console.error("Usage: node ops/local-db.mjs <up|down|reset>");
  process.exit(1);
}

async function main() {
  await ensureDockerEngine(process.env);
  const child = spawn(
    "docker",
    ["compose", "-f", "docker-compose.local.yml", ...actionArgs],
    {
      stdio: "inherit",
      env: process.env,
      shell: false,
    }
  );
  child.once("error", error => {
    console.error(">> Local PostgreSQL command failed:", error.message);
    process.exit(1);
  });
  child.once("exit", code => process.exit(code ?? 1));
}

main().catch(error => {
  console.error(">> Local PostgreSQL command failed:", error.message);
  process.exit(1);
});
