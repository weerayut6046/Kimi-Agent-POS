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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TRPCProvider>
      <DesktopSyncProvider>
        <StaffProvider>
          <RealtimeProvider>
            <AppConfirmDialogProvider>
              <Root />
              <DeferredToaster richColors closeButton />
            </AppConfirmDialogProvider>
          </RealtimeProvider>
        </StaffProvider>
      </DesktopSyncProvider>
    </TRPCProvider>
  </StrictMode>
);
