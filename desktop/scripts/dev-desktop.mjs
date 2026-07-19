/**
 * รัน dev desktop แบบคำสั่งเดียว: เปิด vite dev server (ถ้ายังไม่มี) → รอให้พร้อม → เปิด Electron
 * ปิดหน้าต่าง Electron แล้ว vite จะถูกปิดตาม (ถ้าเป็นฝั่งที่ script เปิดเอง)
 */
import { spawn } from "node:child_process";

const DEV_URL = "http://localhost:3000/";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function isViteUp() {
  try {
    const res = await fetch(DEV_URL);
    return res.ok;
  } catch {
    return false;
  }
}

// ถ้า vite รันอยู่แล้ว (ผู้ใช้เปิดเอง) ไม่ต้องเปิดซ้ำ — เปิด Electron ได้เลย
let vite = null;
if (!(await isViteUp())) {
  console.log(">> เปิด vite dev server...");
  vite = spawn("npx", ["vite"], { stdio: "inherit", shell: true });

  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (await isViteUp()) {
      ready = true;
      break;
    }
    await wait(500);
  }
  if (!ready) {
    console.error(">> vite dev server ไม่พร้อมภายใน 60 วินาที");
    vite.kill();
    process.exit(1);
  }
} else {
  console.log(">> พบ vite dev server รันอยู่แล้ว ใช้ตัวเดิม");
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
const electron = spawn("npx", ["electron", "."], { stdio: "inherit", shell: true });
electron.on("exit", (code) => {
  killVite();
  process.exit(code ?? 0);
});
