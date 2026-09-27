import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type GatewayHandler = (request: Request) => Promise<Response>;

const runtime = {
  mode: "business" as "business" | "platform",
  getDeploymentMode: vi.fn(() => runtime.mode),
  payment: vi.fn(async () => Response.json({ ok: true, matched: false })),
  trpc: vi.fn(async () => Response.json({ ok: true })),
};

let gateway: GatewayHandler;

beforeAll(async () => {
  const environment: Record<string, string> = {
    ALLOWED_ORIGINS: "https://pos.example.test",
    SUPABASE_PUBLISHABLE_KEY: "unit-test-public-key",
  };
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => environment[name] },
    serve: (handler: GatewayHandler) => {
      gateway = handler;
    },
  });
  vi.stubGlobal("__deploymentHttpTestRuntime", runtime);

  // Exercise the real Edge gateway, replacing runtime-native imports and the
  // business bundle so these tests cannot open connections or issue payments.
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./index.ts", import.meta.url))],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "isolated-edge-runtime",
        setup(context) {
          context.onResolve({ filter: /^jsr:/ }, () => ({
            path: "edge-types",
            namespace: "isolated-edge-runtime",
          }));
          context.onResolve({ filter: /app\.bundle\.ts$/ }, () => ({
            path: "business-runtime",
            namespace: "isolated-edge-runtime",
          }));
          context.onResolve(
            { filter: /^@trpc\/server\/adapters\/fetch$/ },
            () => ({
              path: "trpc",
              namespace: "isolated-edge-runtime",
            })
          );
          context.onLoad(
            { filter: /.*/, namespace: "isolated-edge-runtime" },
            args => ({
              contents:
                args.path === "business-runtime"
                  ? `export const edgeAppRouter = {};
               export const createContext = async () => ({});
               export const getDeploymentMode = () => globalThis.__deploymentHttpTestRuntime.getDeploymentMode();
               export const handleIncomingPaymentRequest = request => globalThis.__deploymentHttpTestRuntime.payment(request);`
                  : args.path === "trpc"
                    ? `export const fetchRequestHandler = options => globalThis.__deploymentHttpTestRuntime.trpc(options);`
                    : "export {};",
              loader: "js",
            })
          );
        },
      },
    ],
  });
  const code = result.outputFiles[0].text;
  await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  runtime.mode = "business";
});

function paymentRequest() {
  return new Request(
    "https://project.supabase.co/functions/v1/pos-api/payments/incoming?branch=1",
    {
      method: "POST",
      headers: {
        origin: "https://pos.example.test",
        authorization: "Bearer unit-test-webhook-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 100 }),
    }
  );
}

describe("Edge HTTP deployment boundary", () => {
  it("rejects platform payment webhooks before dispatch with CORS and no-store headers", async () => {
    runtime.mode = "platform";
    const response = await gateway(paymentRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: "This endpoint requires a business deployment",
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://pos.example.test"
    );
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(runtime.payment).not.toHaveBeenCalled();
    expect(runtime.trpc).not.toHaveBeenCalled();
  });

  it("preserves business webhook dispatch and evaluates mode for every request", async () => {
    const first = await gateway(paymentRequest());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, matched: false });
    expect(runtime.payment).toHaveBeenCalledOnce();

    runtime.mode = "platform";
    const second = await gateway(paymentRequest());
    expect(second.status).toBe(403);
    expect(runtime.payment).toHaveBeenCalledOnce();
    expect(runtime.getDeploymentMode).toHaveBeenCalledTimes(2);
  });

  it("keeps platform auth/platform tRPC dispatch and fast ping available", async () => {
    runtime.mode = "platform";
    for (const procedure of ["auth.currentStaff", "platform.listBusinesses"]) {
      const response = await gateway(
        new Request(
          `https://project.supabase.co/functions/v1/pos-api/${procedure}`,
          {
            headers: { apikey: "unit-test-public-key" },
          }
        )
      );
      expect(response.status).toBe(200);
    }
    expect(runtime.trpc).toHaveBeenCalledTimes(2);

    const ping = await gateway(
      new Request("https://project.supabase.co/functions/v1/pos-api/ping", {
        headers: { apikey: "unit-test-public-key" },
      })
    );
    expect(ping.status).toBe(200);
    expect(await ping.json()).toMatchObject({
      result: { data: { json: { ok: true } } },
    });
    expect(runtime.trpc).toHaveBeenCalledTimes(2);
  });
});
