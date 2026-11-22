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
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
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
