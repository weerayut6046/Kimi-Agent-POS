import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { NATIVE_NETWORK_EVENT } from "@/lib/nativeRuntime";

function isNativeOffline() {
  return (
    Capacitor.isNativePlatform() &&
    document.documentElement.dataset.networkStatus === "offline"
  );
}

export default function NativeNetworkBanner() {
  const [offline, setOffline] = useState(isNativeOffline);

  useEffect(() => {
    const update = () => setOffline(isNativeOffline());
    window.addEventListener(NATIVE_NETWORK_EVENT, update);
    update();
    return () => window.removeEventListener(NATIVE_NETWORK_EVENT, update);
  }, []);

  if (!offline) return null;

  return (
    <div
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[100] flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-3 py-2 text-center text-sm font-semibold text-amber-950 shadow-lg backdrop-blur"
      role="alert"
      aria-live="assertive"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      ไม่มีอินเทอร์เน็ต — แอปมือถือต้องออนไลน์ก่อนบันทึกรายการ
    </div>
  );
}
