/**
 * รัน dev desktop แบบคำสั่งเดียว: เปิด Vite ด้วยฐานข้อมูลเดียวกับ Desktop จริง → เปิด Electron
 * ถ้าพอร์ต 3000 มี web dev server ที่ใช้ฐานข้อมูลคนละไฟล์ จะเลือกพอร์ตถัดไปให้อัตโนมัติ
 * ปิดหน้าต่าง Electron แล้ว Vite ที่ script เปิดจะถูกปิดตาม
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const requestedPort = Number.parseInt(process.env.POS_DESKTOP_DEV_PORT || "3000", 10);
const firstPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 3000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const userDataDir = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "pos-app",
);

function desktopDbPath() {
  if (process.env.DATABASE_URL) return path.resolve(process.env.DATABASE_URL);
  try {
    const config = JSON.parse(fs.readFileSync(path.join(userDataDir, "config.json"), "utf8"));
    if (typeof config.dbPath === "string" && config.dbPath.trim()) return path.resolve(config.dbPath);
  } catch {
    // ยังไม่มี config หรือไฟล์อ่านไม่ได้ — ใช้ตำแหน่งมาตรฐานของ Desktop
  }
  return path.join(userDataDir, "pos.db");
}

async function runningDbPath(url) {
  try {
    const res = await fetch(new URL("api/trpc/dbadmin.dbInfo", url));
    if (!res.ok) return null;
    const body = await res.json();
    return body?.result?.data?.json?.dbPath ?? null;
  } catch {
    return null;
  }
}

const portAvailable = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(false));
  server.once("listening", () => server.close(() => resolve(true)));
  server.listen(port, "localhost");
});

const targetDb = desktopDbPath();
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// ใช้ server เดิมได้เฉพาะเมื่อชี้ฐานข้อมูล Desktop ไฟล์เดียวกัน
// ถ้าไม่ตรงให้หาพอร์ตว่าง เพื่อไม่ให้ Desktop เผลออ่าน/เขียน ./data/pos.db ของ web dev
let vite = null;
let devPort = firstPort;
let devUrl = `http://localhost:${devPort}/`;
let existingDb = await runningDbPath(devUrl);
if ((existingDb && !samePath(existingDb, targetDb)) || (!existingDb && !(await portAvailable(devPort)))) {
  if (existingDb) console.log(`>> พอร์ต ${devPort} ใช้ฐานข้อมูล ${existingDb}`);
  let found = false;
  for (let port = devPort + 1; port <= devPort + 20; port++) {
    if (await portAvailable(port)) {
      devPort = port;
      devUrl = `http://localhost:${port}/`;
      existingDb = null;
      found = true;
      break;
    }
  }
  if (!found) {
    console.error(`>> ไม่พบพอร์ตว่างช่วง ${firstPort}-${firstPort + 20}`);
    process.exit(1);
  }
}

if (!existingDb) {
  console.log(`>> เปิด Vite สำหรับ Desktop ที่ ${devUrl}`);
  console.log(`>> ฐานข้อมูล Desktop: ${targetDb}`);
  vite = spawn("npx", ["vite", "--port", String(devPort), "--strictPort"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: targetDb, PORT: String(devPort) },
  });

  let ready = false;
  for (let i = 0; i < 120; i++) {
    const readyDb = await runningDbPath(devUrl);
    if (readyDb && samePath(readyDb, targetDb)) {
      ready = true;
      break;
    }
    await wait(500);
  }
  if (!ready) {
    console.error(">> Vite สำหรับ Desktop ไม่พร้อมภายใน 60 วินาที");
    vite.kill();
    process.exit(1);
  }
} else {
  console.log(`>> ใช้ Vite ที่รันอยู่แล้ว: ${devUrl}`);
  console.log(`>> ฐานข้อมูล Desktop: ${existingDb}`);
}

const killVite = () => {
  if (vite) {
    try {
      vite.kill();
    } catch {
      // ปิดไม่สำเร็จก็ไม่เป็นไร
    }
  }
};
process.on("exit", killVite);

console.log(">> เปิด Electron...");
const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ELECTRON_START_URL: devUrl },
});
electron.on("exit", (code) => {
  killVite();
  process.exit(code ?? 0);
});
