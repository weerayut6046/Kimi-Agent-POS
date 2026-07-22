import type { ProgressInfo } from "builder-util-runtime";

export type DownloadProgressView = {
  percent: number;
  percentText: string;
  transferredText: string;
  totalText: string;
  speedText: string;
};

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatUpdateBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`;
}

export function createDownloadProgressView(
  progress: ProgressInfo
): DownloadProgressView {
  const rawPercent = Number.isFinite(progress.percent)
    ? progress.percent
    : progress.total > 0
      ? (progress.transferred / progress.total) * 100
      : 0;
  const percent = Math.max(0, Math.min(100, rawPercent));

  return {
    percent,
    percentText: `${Math.round(percent)}%`,
    transferredText: formatUpdateBytes(progress.transferred),
    totalText: formatUpdateBytes(progress.total),
    speedText:
      progress.bytesPerSecond > 0
        ? `${formatUpdateBytes(progress.bytesPerSecond)}/วินาที`
        : "กำลังเชื่อมต่อ...",
  };
}

export function describeUpdateError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "ไม่ทราบสาเหตุ");

  if (/ERR_HTTP2_SERVER_REFUSED_STREAM/i.test(message)) {
    return "เซิร์ฟเวอร์ปฏิเสธการเชื่อมต่อชั่วคราว กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่";
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return "ไม่พบเซิร์ฟเวอร์ดาวน์โหลด กรุณาตรวจการเชื่อมต่ออินเทอร์เน็ต";
  }
  if (/ETIMEDOUT|ERR_TIMED_OUT|timeout/i.test(message)) {
    return "การดาวน์โหลดใช้เวลานานเกินกำหนด กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่";
  }
  if (/checksum|sha512/i.test(message)) {
    return "ไฟล์ที่ดาวน์โหลดไม่สมบูรณ์ ระบบจะดาวน์โหลดไฟล์ใหม่เมื่อกดลองอีกครั้ง";
  }
  if (/signature/i.test(message)) {
    return "ตรวจสอบลายเซ็นของไฟล์อัปเดตไม่ผ่าน กรุณาใช้ตัวติดตั้งจากแหล่งทางการ";
  }

  return `ไม่สามารถดาวน์โหลดอัปเดตได้ (${message.slice(0, 180)})`;
}

export const DOWNLOAD_PROGRESS_HTML = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>กำลังดาวน์โหลดอัปเดต</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: #172033;
      background: radial-gradient(circle at top right, #ede9fe, transparent 45%), #f8fafc;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    main { width: 100%; padding: 24px 28px; }
    .eyebrow { color: #6d5df4; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 7px 0 5px; font-size: 20px; }
    p { margin: 0; color: #64748b; font-size: 12px; }
    .track { height: 12px; margin-top: 20px; overflow: hidden; border-radius: 999px; background: #e2e8f0; box-shadow: inset 0 1px 3px rgb(15 23 42 / .12); }
    .bar { width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #6d5df4, #22d3ee); transition: width .25s ease; }
    .stats { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; color: #475569; }
    .percent { color: #302c73; font-size: 16px; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">POS Pump Update</div>
    <h1 id="title">กำลังเตรียมดาวน์โหลดอัปเดต...</h1>
    <p>ใช้งานโปรแกรมต่อได้ตามปกติ กรุณาอย่าปิดเครื่องระหว่างดาวน์โหลด</p>
    <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div id="bar" class="bar"></div>
    </div>
    <div class="stats">
      <span id="bytes">กำลังเชื่อมต่อ...</span>
      <span id="speed"></span>
      <span id="percent" class="percent">0%</span>
    </div>
  </main>
  <script>
    window.setDownloadState = state => {
      const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
      document.getElementById("title").textContent = "กำลังดาวน์โหลดเวอร์ชัน " + state.version;
      document.getElementById("bar").style.width = String(percent) + "%";
      document.getElementById("bytes").textContent = state.transferredText + " / " + state.totalText;
      document.getElementById("speed").textContent = state.speedText;
      document.getElementById("percent").textContent = state.percentText;
      const track = document.querySelector('[role="progressbar"]');
      track.setAttribute("aria-valuenow", String(Math.round(percent)));
    };
  </script>
</body>
</html>`;
