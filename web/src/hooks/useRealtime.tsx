import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  RealtimeChannel,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";
import { isRealtimeInvalidationEvent } from "@contracts/realtime";
import { useStaff } from "./useStaff";
import { createSseParser } from "@/lib/realtimeSse";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const STAFF_STORAGE_KEY = "pumppos_staff";
const SUPABASE_TOPIC = "pos-invalidation-v1";
const SUPABASE_EVENT = "invalidate";

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

    const seen = new Set<string>();
    let supabase: SupabaseClient | null = null;
    let stopped = false;
    let invalidateTimer: number | undefined;
    let sseController: AbortController | null = null;
    let channel: RealtimeChannel | null = null;
    let channelConnecting = false;
    let supabaseSubscribed = false;

    const invalidateActiveQueries = () => {
      if (invalidateTimer !== undefined) return;
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined;
        void queryClient.invalidateQueries({ refetchType: "active" });
      }, 75);
    };

    const acceptEvent = (event: unknown) => {
      if (!isRealtimeInvalidationEvent(event)) return;
      if (seen.has(event.eventId)) return;
      seen.add(event.eventId);
      if (seen.size > 256) {
        const oldest = seen.values().next().value as string | undefined;
        if (oldest) seen.delete(oldest);
      }
      invalidateActiveQueries();
    };

    const connectSse = async (controller: AbortController) => {
      let retryMs = 1_000;
      while (!controller.signal.aborted && !stopped && !supabaseSubscribed) {
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
              acceptEvent(JSON.parse(message.data) as unknown);
            } catch {
              // Ignore malformed frames. No untrusted payload reaches app state.
            }
          });
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (!controller.signal.aborted && !supabaseSubscribed) {
            const { done, value } = await reader.read();
            if (done) break;
            parse(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          if (controller.signal.aborted || stopped) return;
          if (error instanceof Error && error.name === "AbortError") return;
        }

        await wait(retryMs, controller.signal);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    };

    const startSseFallback = () => {
      if (stopped || supabaseSubscribed || sseController) return;
      const controller = new AbortController();
      sseController = controller;
      void connectSse(controller).finally(() => {
        if (sseController === controller) sseController = null;
      });
    };

    const stopSseFallback = () => {
      const controller = sseController;
      sseController = null;
      controller?.abort();
    };

    const authenticateRealtime = async (session: Session) => {
      if (!supabase || stopped) return;
      await supabase.realtime.setAuth(session.access_token);
    };

    const connectSupabase = async (session: Session) => {
      if (!supabase || stopped || channel || channelConnecting) return;
      channelConnecting = true;
      try {
        await authenticateRealtime(session);
        if (stopped) return;

        const nextChannel = supabase
          .channel(SUPABASE_TOPIC, { config: { private: true } })
          .on("broadcast", { event: SUPABASE_EVENT }, message =>
            acceptEvent(message.payload)
          );
        channel = nextChannel;
        nextChannel.subscribe(status => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            supabaseSubscribed = true;
            stopSseFallback();
            // Re-fetch after switching transports to close the handover window.
            invalidateActiveQueries();
            return;
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            supabaseSubscribed = false;
            startSseFallback();
          }
        });
      } catch {
        supabaseSubscribed = false;
        startSseFallback();
      } finally {
        channelConnecting = false;
      }
    };

    startSseFallback();

    let authSubscription: { unsubscribe: () => void } | null = null;
    void getSupabaseBrowserClient().then(client => {
      if (!client || stopped) return;
      supabase = client;
      void client.auth.getSession().then(({ data }) => {
        if (data.session) void connectSupabase(data.session);
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // Defer Supabase calls until after the Auth callback releases its lock.
        window.setTimeout(() => {
          if (stopped) return;
          if (session) {
            void authenticateRealtime(session).then(() => {
              if (!channel) void connectSupabase(session);
            });
          } else {
            supabaseSubscribed = false;
            startSseFallback();
          }
        }, 0);
      });
      authSubscription = data.subscription;
    });

    return () => {
      stopped = true;
      authSubscription?.unsubscribe();
      stopSseFallback();
      if (channel && supabase) void supabase.removeChannel(channel);
      if (invalidateTimer !== undefined) window.clearTimeout(invalidateTimer);
    };
  }, [queryClient, staffId]);

  return children;
}
