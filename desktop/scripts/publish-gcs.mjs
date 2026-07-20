/**
 * อัปโหลดไฟล์ Desktop release ไป Google Cloud Storage สำหรับ electron-updater generic provider
 * ใช้หลัง `npm run dist:exe` และต้อง login gcloud ไว้แล้ว
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..", "..");
const releaseDir = path.join(root, "release");
const version = require(path.join(root, "package.json")).version;
const bucket = process.env.POS_UPDATE_BUCKET || "kimi-agent-pos-updates";

if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) {
  throw new Error(`ชื่อ Bucket ไม่ถูกต้อง: ${bucket}`);
}

const names = [
  `POS-Pump-Setup-${version}.exe`,
  `POS-Pump-Portable-${version}.exe`,
  `POS-Pump-Setup-${version}.exe.blockmap`,
  "latest.yml",
];
const files = names.map((name) => path.join(releaseDir, name));
for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`ไม่พบไฟล์ release: ${file}`);
}

const candidates = process.platform === "win32"
  ? [
      path.join(process.env.LOCALAPPDATA || os.homedir(), "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd"),
      "gcloud.cmd",
    ]
  : ["gcloud"];
const gcloud = candidates.find((candidate) => candidate === "gcloud" || candidate === "gcloud.cmd" || fs.existsSync(candidate));
if (!gcloud) throw new Error("ไม่พบ Google Cloud CLI (gcloud)");
const gcloudDir = path.dirname(gcloud);
const gcloudCommand = path.basename(gcloud);

function run(args) {
  const result = spawnSync(gcloudCommand, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      PATH: gcloudDir === "."
        ? process.env.PATH
        : `${gcloudDir}${path.delimiter}${process.env.PATH || ""}`,
    },
  });
  if ((result.status ?? 1) !== 0) throw new Error(`gcloud ล้มเหลว: ${args.join(" ")}`);
}

console.log(`>> อัปโหลด POS ${version} ไป gs://${bucket}/`);
run(["storage", "cp", ...files, `gs://${bucket}/`]);
run([
  "storage", "objects", "update",
  `gs://${bucket}/latest.yml`,
  "--cache-control=no-cache,max-age=0",
  "--content-type=text/yaml",
]);
run([
  "storage", "objects", "update",
  ...names.filter((name) => name !== "latest.yml").map((name) => `gs://${bucket}/${name}`),
  "--cache-control=public,max-age=31536000,immutable",
]);

const publicBase = `https://storage.googleapis.com/${bucket}/`;
for (const [index, name] of names.entries()) {
  const response = await fetch(new URL(name, publicBase), { method: "HEAD" });
  if (!response.ok) throw new Error(`ตรวจ URL ไม่ผ่าน (${response.status}): ${name}`);
  const expected = fs.statSync(files[index]).size;
  const actual = Number(response.headers.get("content-length"));
  if (actual !== expected) throw new Error(`ขนาดไฟล์ไม่ตรง ${name}: local=${expected}, cloud=${actual}`);
}

console.log(`>> เผยแพร่สำเร็จ: ${publicBase}latest.yml`);
