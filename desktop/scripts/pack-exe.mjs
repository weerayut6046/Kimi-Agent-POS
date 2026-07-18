/**
 * pack-exe.mjs — สร้าง .exe ด้วย electron-builder โดยสลับ better-sqlite3 เป็น Electron ABI ชั่วคราว
 *
 * เครื่อง build ไม่มี Visual Studio (node-gyp ใช้ไม่ได้) จึง:
 *  1. ดาวน์โหลด prebuilt binary ของ better-sqlite3 จาก GitHub Releases (cache ใน .cache/native)
 *  2. สลับ binary ใน node_modules เป็นเวอร์ชัน Electron ABI
 *  3. รัน electron-builder (npmRebuild=false)
 *  4. สลับกลับเป็น Node ABI สำหรับ dev (ทำเสมอแม้ build ล้ม)
 *
 * ใช้: node desktop/scripts/pack-exe.mjs   (ผ่าน npm run dist:exe)
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..", "..");
const pkgDir = path.join(root, "node_modules", "better-sqlite3");
const releaseDir = path.join(pkgDir, "build", "Release");
const bindingFile = path.join(releaseDir, "better_sqlite3.node");
const cacheDir = path.join(root, ".cache", "native");

const bsVer = require(path.join(pkgDir, "package.json")).version;
const electronVer = require(path.join(root, "node_modules", "electron", "package.json")).version;
const nodeAbi = require("node-abi");
const eAbi = nodeAbi.getAbi(electronVer, "electron");
const nAbi = nodeAbi.getAbi(process.version, "node");

/** ดาวน์โหลด prebuilt .node จาก GitHub Releases (ถ้ายังไม่มีใน cache) แล้วคืน path ใน cache */
function ensureCached(runtime, abi) {
  const cached = path.join(cacheDir, `better_sqlite3-${runtime}-v${abi}.node`);
  if (fs.existsSync(cached)) return cached;

  fs.mkdirSync(cacheDir, { recursive: true });
  const name = `better-sqlite3-v${bsVer}-${runtime}-v${abi}-win32-x64`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${bsVer}/${name}.tar.gz`;
  const tgz = path.join(cacheDir, `${name}.tar.gz`);
  console.log(`>> downloading ${url}`);
  execFileSync("curl", ["-L", "-f", "-sS", "-o", tgz, url], { stdio: "inherit" });

  const extractDir = path.join(cacheDir, name);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  // ใช้ relative path + cwd เพราะ GNU tar บน Windows เข้าใจ "D:\..." เป็น remote host
  execFileSync("tar", ["-xzf", `${name}.tar.gz`, "-C", name], { cwd: cacheDir, stdio: "inherit" });

  const stack = [extractDir];
  let found = null;
  while (stack.length && !found) {
    for (const e of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
      const p = path.join(e.path ?? extractDir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === "better_sqlite3.node") { found = p; break; }
    }
  }
  if (!found) throw new Error(`ไม่พบ better_sqlite3.node ใน ${name}.tar.gz`);
  fs.copyFileSync(found, cached);
  return cached;
}

const electronBin = ensureCached("electron", eAbi);
const nodeBin = ensureCached("node", nAbi);

fs.mkdirSync(releaseDir, { recursive: true });

console.log(`>> better-sqlite3 ${bsVer}: สลับเป็น Electron ABI v${eAbi} (Electron ${electronVer})`);
fs.copyFileSync(electronBin, bindingFile);

let code = 1;
try {
  // ส่งอาร์กิวเมนต์เพิ่มเติมต่อให้ electron-builder ได้ เช่น -c.directories.output=release2
  const extraArgs = process.argv.slice(2);
  const r = spawnSync(
    "npx",
    ["electron-builder", "--win", "--config", "desktop/electron-builder.yml", ...extraArgs],
    {
      stdio: "inherit",
      shell: true,
      cwd: root,
    },
  );
  code = r.status ?? 1;
} finally {
  // สลับกลับเป็น Node ABI สำหรับ dev/CLI เสมอ
  console.log(`>> สลับกลับเป็น Node ABI v${nAbi}`);
  fs.copyFileSync(nodeBin, bindingFile);
}
process.exit(code);
