import { randomUUID } from "node:crypto";
import {
  isRealtimeInvalidationEvent,
  REALTIME_EVENT_VERSION,
  type RealtimeInvalidationEvent,
} from "@contracts/realtime";
import { env } from "./env";
import { getPostgresClient } from "../queries/connection";
import { getDeploymentMode } from "./deployment";

const CHANNEL = "pos_app_invalidation_v1";
const SUPABASE_TOPIC_PREFIX = "pos-invalidation-v1";
const SUPABASE_EVENT = "invalidate";
const MAX_CLIENTS = 250;
const MAX_CLIENTS_PER_STAFF = 20;
const MAX_RECENT_EVENT_IDS = 512;
const SUBSCRIBER_LEASE_MS = 60_000;
const isEdgeRuntime =
  typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined";

type Subscriber = {
  staffId: number;
  branchId: number;
  lastSeenAt: number;
  listener: (event: RealtimeInvalidationEvent) => void;
};

export type RealtimeSubscription = {
  touch: () => void;
  unsubscribe: () => void;
};

const subscribers = new Map<string, Subscriber>();
const recentEventIds = new Set<string>();
let listenerStart: Promise<void> | null = null;

export class RealtimeCapacityError extends Error {
  constructor() {
    super("Realtime connection capacity reached");
  }
}

function rememberEventId(eventId: string): boolean {
  if (recentEventIds.has(eventId)) return false;
  recentEventIds.add(eventId);
  if (recentEventIds.size > MAX_RECENT_EVENT_IDS) {
    const oldest = recentEventIds.values().next().value as string | undefined;
    if (oldest) recentEventIds.delete(oldest);
  }
  return true;
}

function dispatch(event: RealtimeInvalidationEvent): void {
  if (!rememberEventId(event.eventId)) return;
  for (const { branchId, listener } of subscribers.values()) {
    if (branchId !== event.branchId) continue;
    try {
      listener(event);
    } catch {
      // One disconnected client must never interrupt delivery to other clients.
    }
  }
}

function pruneExpiredSubscribers(now = Date.now()): void {
  const oldestAllowed = now - SUBSCRIBER_LEASE_MS;
  for (const [subscriptionId, subscriber] of subscribers) {
    if (
      typeof subscriber.lastSeenAt !== "number" ||
      subscriber.lastSeenAt < oldestAllowed
    ) {
      subscribers.delete(subscriptionId);
    }
  }
}

function parseDatabaseEvent(payload: string): RealtimeInvalidationEvent | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRealtimeInvalidationEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function ensureDatabaseListener(): void {
  if (process.env.NODE_ENV === "test" || !env.databaseUrl || listenerStart) {
    return;
  }

  listenerStart = getPostgresClient()
    .listen(CHANNEL, payload => {
      const event = parseDatabaseEvent(payload);
      if (event) dispatch(event);
    })
    .then(() => undefined)
    .catch(error => {
      listenerStart = null;
      console.error(
        "Realtime database listener could not start; connected clients will retry on their next connection:",
        error instanceof Error ? error.message : "unknown error"
      );
    });
}

async function publishSupabaseBroadcast(
  event: RealtimeInvalidationEvent
): Promise<void> {
  if (!env.supabaseUrl || !env.supabaseSecretKey) return;
  const endpoint =
    `${env.supabaseUrl}/realtime/v1/api/broadcast/` +
    `${encodeURIComponent(`${SUPABASE_TOPIC_PREFIX}:${event.branchId}`)}/events/` +
    `${encodeURIComponent(SUPABASE_EVENT)}?private=true`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.supabaseSecretKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error(`http_${response.status}`);
  }
}

/**
 * Publish only an opaque invalidation signal. Business data remains behind the
 * authenticated tRPC API and is never placed on PostgreSQL NOTIFY or SSE.
 */
export function publishRealtimeInvalidation(
  branchId = 1
): RealtimeInvalidationEvent {
  const event: RealtimeInvalidationEvent = {
    version: REALTIME_EVENT_VERSION,
    eventId: randomUUID(),
    scope: "branch",
    branchId,
  };

  // Audit and authentication helpers also publish here. Keep the deployment
  // boundary central so the platform never opens POS publication transports.
  if (getDeploymentMode() !== "business") return event;

  // Deliver immediately to clients attached to this backend instance.
  dispatch(event);

  // PostgreSQL NOTIFY fans the same opaque event out to other backend replicas.
  // Failure must not turn an already-committed business mutation into an error.
  if (process.env.NODE_ENV !== "test" && !isEdgeRuntime && env.databaseUrl) {
    void getPostgresClient()
      .notify(CHANNEL, JSON.stringify(event))
      .catch(error => {
        console.error(
          "Realtime invalidation publish failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
  }

  // Supabase Broadcast carries the same opaque signal to private channels.
  // The secret key stays server-side and is sent only in the apikey header.
  if (process.env.NODE_ENV !== "test") {
    void publishSupabaseBroadcast(event).catch(error => {
      console.error(
        "Supabase Realtime invalidation publish failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    });
  }

  return event;
}

export function subscribeRealtime(
  staffId: number,
  branchId: number,
  listener: (event: RealtimeInvalidationEvent) => void
): RealtimeSubscription {
  const now = Date.now();
  pruneExpiredSubscribers(now);
  const staffConnections = [...subscribers.values()].filter(
    subscriber => subscriber.staffId === staffId
  ).length;
  if (
    subscribers.size >= MAX_CLIENTS ||
    staffConnections >= MAX_CLIENTS_PER_STAFF
  ) {
    throw new RealtimeCapacityError();
  }

  const subscriptionId = randomUUID();
  subscribers.set(subscriptionId, {
    staffId,
    branchId,
    lastSeenAt: now,
    listener,
  });
  ensureDatabaseListener();

  return {
    touch: () => {
      const subscriber = subscribers.get(subscriptionId);
      if (subscriber) subscriber.lastSeenAt = Date.now();
    },
    unsubscribe: () => {
      subscribers.delete(subscriptionId);
    },
  };
}

export const realtimeTestUtils =
  process.env.NODE_ENV === "test"
    ? {
        subscriberCount: () => subscribers.size,
        reset: () => {
          subscribers.clear();
          recentEventIds.clear();
          listenerStart = null;
        },
      }
    : undefined;
