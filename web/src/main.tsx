import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./login.css";
import { TRPCProvider } from "@/providers/trpc";
import { StaffProvider } from "@/hooks/useStaff";
import { DesktopSyncProvider } from "@/hooks/useDesktopSync";
import { RealtimeProvider } from "@/hooks/useRealtime";
import Root from "@/Root";
import DeferredToaster from "@/components/DeferredToaster";
import { AppConfirmDialogProvider } from "@/components/AppConfirmDialog";
import NativeNetworkBanner from "@/components/NativeNetworkBanner";
import { initializeNativeRuntime } from "@/lib/nativeRuntime";

void initializeNativeRuntime().catch(() => {
  // A native bridge failure must not prevent the POS UI from starting.
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TRPCProvider>
      <DesktopSyncProvider>
        <StaffProvider>
          <RealtimeProvider>
            <AppConfirmDialogProvider>
              <Root />
              <NativeNetworkBanner />
              <DeferredToaster richColors closeButton />
            </AppConfirmDialogProvider>
          </RealtimeProvider>
        </StaffProvider>
      </DesktopSyncProvider>
    </TRPCProvider>
  </StrictMode>
);
