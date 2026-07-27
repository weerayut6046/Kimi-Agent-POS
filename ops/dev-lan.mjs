/** รัน Vite dev server แบบเปิดให้เครื่องอื่นใน LAN เชื่อมต่อ (BIND_HOST=0.0.0.0)
 *  ใช้ node ตั้ง env แทน syntax ของ shell เพื่อให้ทำงานได้ทั้ง Windows/macOS/Linux */
import { spawn } from "node:child_process";

console.log(
  ">> เปิด Vite แบบ LAN (BIND_HOST=0.0.0.0) — เครื่องอื่นในวงเดียวกันเปิดผ่าน URL ที่ขึ้น Network:"
);
const vite = spawn("npx", ["vite"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, BIND_HOST: "0.0.0.0" },
});
vite.on("exit", code => process.exit(code ?? 0));
