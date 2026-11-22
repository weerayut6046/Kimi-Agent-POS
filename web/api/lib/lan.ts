import os from "os";

const VIRTUAL_ADAPTER =
  /vethernet|wsl|hyper-v|docker|vmware|virtualbox|loopback|pseudo/i;

export function isPublicCloudRuntime(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.CF_PAGES === "1" ||
    typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined"
  );
}

export function getLanUrls(port: number): string[] {
  if (isPublicCloudRuntime()) return [];
  const urls: string[] = [];
  let interfaces: ReturnType<typeof os.networkInterfaces>;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    // A restricted host can serve POS requests without exposing local interfaces.
    return [];
  }
  for (const [name, infos] of Object.entries(interfaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue;
    for (const info of infos ?? []) {
      const family = String(info.family);
      if ((family === "IPv4" || family === "4") && !info.internal) {
        urls.push(`http://${info.address}:${port}`);
      }
    }
  }
  return [...new Set(urls)];
}
