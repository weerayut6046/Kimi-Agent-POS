import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import { TRPCProvider } from "@/providers/trpc";
import { StaffProvider } from "@/hooks/useStaff";
import { DesktopSyncProvider } from "@/hooks/useDesktopSync";
import { RealtimeProvider } from "@/hooks/useRealtime";
import App from "./App.tsx";
import { Toaster } from "@/components/ui/sonner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <DesktopSyncProvider>
          <StaffProvider>
            <RealtimeProvider>
              <App />
              <Toaster richColors closeButton />
            </RealtimeProvider>
          </StaffProvider>
        </DesktopSyncProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>
);
