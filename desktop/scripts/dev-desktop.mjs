/** Run Vite against the configured Supabase database, then open Electron. */
import { spawn } from "node:child_process";
import net from "node:net";

if (!process.env.DATABASE_URL) {
  console.error(">> กรุณาตั้ง DATABASE_URL ของ Supabase ก่อนรัน npm run dev:desktop");
  process.exit(1);
}

const requestedPort = Number.parseInt(
  process.env.POS_DESKTOP_DEV_PORT || "3000",
  10,
);
const firstPort =
  Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const portAvailable = port =>
  new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "localhost");
  });

let devPort = 0;
for (let port = firstPort; port <= firstPort + 20; port += 1) {
  if (await portAvailable(port)) {
    devPort = port;
    break;
  }
}
if (!devPort) {
  console.error(`>> ไม่พบพอร์ตว่างช่วง ${firstPort}-${firstPort + 20}`);
  process.exit(1);
}

const devUrl = `http://localhost:${devPort}/`;
console.log(`>> เปิด Vite สำหรับ Desktop ที่ ${devUrl} (Supabase PostgreSQL)`);
const vite = spawn("npx", ["vite", "--port", String(devPort), "--strictPort"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PORT: String(devPort) },
});

let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    const response = await fetch(devUrl);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // Vite is still starting.
  }
  await wait(500);
}
if (!ready) {
  console.error(">> Vite สำหรับ Desktop ไม่พร้อมภายใน 60 วินาที");
  vite.kill();
  process.exit(1);
}

const killVite = () => {
  try {
    vite.kill();
  } catch {
    // Process already exited.
  }
};
process.on("exit", killVite);

console.log(">> เปิด Electron...");
const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ELECTRON_START_URL: devUrl },
});
electron.on("exit", code => {
  killVite();
  process.exit(code ?? 0);
});
