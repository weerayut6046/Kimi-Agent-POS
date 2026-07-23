/** Build Windows installer/portable packages and enforce release signing. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..", "..");
const selfSignedPfx = path.join(
  root,
  "desktop",
  "certs",
  "pumpos-codesign.pfx",
);
const selfSignedPassword = path.join(
  root,
  "desktop",
  "certs",
  "pfx-password.txt",
);
const allowSelfSignedFlag = "--allow-self-signed";
const inputArgs = process.argv.slice(2);
const allowSelfSigned = inputArgs.includes(allowSelfSignedFlag);
const builderArgs = inputArgs.filter(arg => arg !== allowSelfSignedFlag);
const externalSigningConfigured = Boolean(
  process.env.WIN_CSC_LINK || process.env.CSC_LINK,
);

if (!externalSigningConfigured) {
  if (!allowSelfSigned) {
    console.error(
      ">> หยุด build: production release ต้องกำหนด WIN_CSC_LINK/WIN_CSC_KEY_PASSWORD " +
        "ด้วย public-trust code-signing certificate",
    );
    console.error(
      ">> ห้ามใช้ self-signed กับไฟล์เผยแพร่; ใช้ npm run dist:exe:self-signed สำหรับ dev เท่านั้น",
    );
    process.exit(1);
  }

  if (!fs.existsSync(selfSignedPfx)) {
    console.error(
      ">> ไม่พบ desktop/certs/pumpos-codesign.pfx สำหรับ self-signed dev build",
    );
    process.exit(1);
  }

  process.env.CSC_LINK = selfSignedPfx;
  process.env.CSC_KEY_PASSWORD = fs.existsSync(selfSignedPassword)
    ? fs.readFileSync(selfSignedPassword, "utf8").trim()
    : "";
  console.log(
    ">> ใช้ self-signed certificate สำหรับ dev build เท่านั้น; ห้าม publish ไฟล์ชุดนี้",
  );
} else {
  console.log(
    ">> ใช้ code-signing identity จาก environment; จะตรวจ public trust หลัง build",
  );
}

const electronBuilderCli = path.join(
  root,
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js",
);
const build = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    "--win",
    "--config",
    "desktop/electron-builder.yml",
    ...builderArgs,
  ],
  {
    stdio: "inherit",
    shell: false,
    cwd: root,
    env: process.env,
  },
);

if (build.error) {
  console.error(`>> เรียก electron-builder ไม่สำเร็จ: ${build.error.message}`);
  process.exit(1);
}
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1);

const verifyScript = path.join(
  root,
  "desktop",
  "scripts",
  "verify-release-signatures.ps1",
);
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const verifyArgs = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  verifyScript,
];
if (allowSelfSigned && !externalSigningConfigured) {
  verifyArgs.push("-AllowSelfSigned");
}

const verify = spawnSync(powershell, verifyArgs, {
  stdio: "inherit",
  shell: false,
  cwd: root,
});
process.exit(verify.status ?? 1);
