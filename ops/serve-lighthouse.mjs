import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 3000;
const auditUrl = `http://${host}:${port}/`;

async function inspectExistingServer() {
  try {
    const response = await fetch(auditUrl, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(2_000),
    });
    const html = await response.text();

    if (html.includes("/@vite/client")) {
      console.error(
        `Port ${port} is running the Vite development server. Stop "npm run dev" before auditing.`,
      );
      process.exit(1);
    }

    if (html.includes("/assets/")) {
      console.log(`Production preview is already ready at ${auditUrl}`);
      process.exit(0);
    }

    console.error(
      `Port ${port} is already used by another application. Stop it before auditing.`,
    );
    process.exit(1);
  } catch {
    // No HTTP server responded, so this process can start the preview.
  }
}

await inspectExistingServer();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const viteEntry = path.resolve(
  scriptDirectory,
  "..",
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);
const preview = spawn(
  process.execPath,
  [
    viteEntry,
    "preview",
    "--host",
    host,
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => preview.kill(signal));
}

preview.on("error", error => {
  console.error(`Unable to start the production preview: ${error.message}`);
  process.exit(1);
});

preview.on("exit", code => {
  process.exit(code ?? 0);
});
