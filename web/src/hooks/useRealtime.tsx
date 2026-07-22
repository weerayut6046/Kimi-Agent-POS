import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isRealtimeInvalidationEvent } from "@contracts/realtime";
import { useStaff } from "./useStaff";
import { createSseParser } from "@/lib/realtimeSse";

const STAFF_STORAGE_KEY = "pumppos_staff";

function currentSessionToken(): string | null {
  try {
    const raw = localStorage.getItem(STAFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { staff } = useStaff();
  const queryClient = useQueryClient();
  const staffId = staff?.id;

  useEffect(() => {
    if (!staffId) return;

    const controller = new AbortController();
    const seen = new Set<string>();
    let invalidateTimer: number | undefined;

    const invalidateActiveQueries = () => {
      if (invalidateTimer !== undefined) return;
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined;
        void queryClient.invalidateQueries({ refetchType: "active" });
      }, 75);
    };

    const connect = async () => {
      let retryMs = 1_000;
      while (!controller.signal.aborted) {
        const token = currentSessionToken();
        if (!token) return;

        try {
          const response = await fetch("/api/realtime", {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              "x-staff-session": token,
            },
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Realtime unavailable (${response.status})`);
          }

          retryMs = 1_000;
          const parse = createSseParser(message => {
            if (message.event === "ready") {
              // Re-fetch after every reconnect to close any event-loss window.
              invalidateActiveQueries();
              return;
            }
            if (message.event !== "invalidate") return;
            try {
              const event: unknown = JSON.parse(message.data);
              if (!isRealtimeInvalidationEvent(event)) return;
              if (seen.has(event.eventId)) return;
              seen.add(event.eventId);
              if (seen.size > 256) {
                const oldest = seen.values().next().value as string | undefined;
                if (oldest) seen.delete(oldest);
              }
              invalidateActiveQueries();
            } catch {
              // Ignore malformed frames. No untrusted payload reaches app state.
            }
          });
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          // Keep existing polling as a safety net while reconnecting.
          if (error instanceof Error && error.name === "AbortError") return;
        }

        await wait(retryMs, controller.signal);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    };

    void connect();
    return () => {
      controller.abort();
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
    };
  }, [queryClient, staffId]);

  return children;
}
