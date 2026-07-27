/** รัน production server (dist/boot.js) — ตั้ง NODE_ENV ผ่าน node
 *  เพื่อให้ npm start ใช้ได้ทั้ง Windows/macOS/Linux (cmd.exe ไม่เข้าใจ VAR=value)
 *  หมายเหตุ: ต้อง npm run build ก่อนเพื่อให้ dist/ เป็นปัจจุบัน */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("dist/boot.js")) {
  console.error(">> ไม่พบ dist/boot.js — รัน npm run build ก่อน");
  process.exit(1);
}

const server = spawn(process.execPath, ["dist/boot.js"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
});
server.on("exit", code => process.exit(code ?? 0));
