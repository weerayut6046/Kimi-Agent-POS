import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./login.css";
import { TRPCProvider } from "@/providers/trpc";
import { StaffProvider } from "@/hooks/useStaff";
import { DesktopSyncProvider } from "@/hooks/useDesktopSync";
import { RealtimeProvider } from "@/hooks/useRealtime";
import Root from "@/Root";
import DeferredToaster from "@/components/DeferredToaster";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TRPCProvider>
      <DesktopSyncProvider>
        <StaffProvider>
          <RealtimeProvider>
            <Root />
            <DeferredToaster richColors closeButton />
          </RealtimeProvider>
        </StaffProvider>
      </DesktopSyncProvider>
    </TRPCProvider>
  </StrictMode>
);
