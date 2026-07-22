import { randomUUID } from "node:crypto";
import {
  isRealtimeInvalidationEvent,
  REALTIME_EVENT_VERSION,
  type RealtimeInvalidationEvent,
} from "@contracts/realtime";
import { env } from "./env";
import { getPostgresClient } from "../queries/connection";

const CHANNEL = "pos_app_invalidation_v1";
const MAX_CLIENTS = 250;
const MAX_CLIENTS_PER_STAFF = 20;
const MAX_RECENT_EVENT_IDS = 512;

type Subscriber = {
  staffId: number;
  listener: (event: RealtimeInvalidationEvent) => void;
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
  for (const { listener } of subscribers.values()) {
    try {
      listener(event);
    } catch {
      // One disconnected client must never interrupt delivery to other clients.
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

/**
 * Publish only an opaque invalidation signal. Business data remains behind the
 * authenticated tRPC API and is never placed on PostgreSQL NOTIFY or SSE.
 */
export function publishRealtimeInvalidation(): RealtimeInvalidationEvent {
  const event: RealtimeInvalidationEvent = {
    version: REALTIME_EVENT_VERSION,
    eventId: randomUUID(),
    scope: "all",
  };

  // Deliver immediately to clients attached to this backend instance.
  dispatch(event);

  // PostgreSQL NOTIFY fans the same opaque event out to other backend replicas.
  // Failure must not turn an already-committed business mutation into an error.
  if (process.env.NODE_ENV !== "test" && env.databaseUrl) {
    void getPostgresClient()
      .notify(CHANNEL, JSON.stringify(event))
      .catch(error => {
        console.error(
          "Realtime invalidation publish failed:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
  }

  return event;
}

export function subscribeRealtime(
  staffId: number,
  listener: (event: RealtimeInvalidationEvent) => void
): () => void {
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
  subscribers.set(subscriptionId, { staffId, listener });
  ensureDatabaseListener();

  return () => {
    subscribers.delete(subscriptionId);
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
