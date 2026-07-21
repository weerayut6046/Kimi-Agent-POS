/** Build signed Windows installer/portable packages with electron-builder. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..", "..");
const pfxFile = path.join(root, "desktop", "certs", "pumpos-codesign.pfx");
const pfxPassFile = path.join(root, "desktop", "certs", "pfx-password.txt");

if (fs.existsSync(pfxFile)) {
  process.env.CSC_LINK = pfxFile;
  process.env.CSC_KEY_PASSWORD = fs.existsSync(pfxPassFile)
    ? fs.readFileSync(pfxPassFile, "utf8").trim()
    : "";
  console.log(">> พบ code-signing certificate — sign build นี้ (self-signed)");
} else {
  console.log(">> ไม่พบ desktop/certs/pumpos-codesign.pfx — build แบบ unsigned");
}

const result = spawnSync(
  "npx",
  [
    "electron-builder",
    "--win",
    "--config",
    "desktop/electron-builder.yml",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    shell: true,
    cwd: root,
  },
);

process.exit(result.status ?? 1);
