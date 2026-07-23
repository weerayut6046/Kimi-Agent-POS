import { describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { DEFAULT_SETTINGS } from "../../../web/contracts/settings.ts";
import { CATALOG_DEFAULT_SETTINGS, createCatalogReader } from "./catalog.ts";

type FakeClient = ReturnType<typeof postgres>;

function clientReturning(value: unknown): FakeClient {
  const client = vi.fn(() => Promise.resolve(value)) as unknown as FakeClient;
  client.end = vi.fn(async () => undefined);
  client.begin = vi.fn(async callback =>
    callback(client as unknown as postgres.TransactionSql)
  ) as FakeClient["begin"];
  return client;
}

function clientFailing(error: Error): FakeClient {
  const client = vi.fn(() => Promise.reject(error)) as unknown as FakeClient;
  client.end = vi.fn(async () => undefined);
  client.begin = vi.fn(async callback =>
    callback(client as unknown as postgres.TransactionSql)
  ) as FakeClient["begin"];
  return client;
}

function clientMatching(
  matches: ReadonlyArray<readonly [string, unknown]>
): FakeClient {
  const client = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    if (query.includes("select set_config('app.branch_id'")) {
      return Promise.resolve([{ set_config: "7" }]);
    }
    const match = matches.find(([pattern]) => query.includes(pattern));
    if (!match) return Promise.reject(new Error(`Unexpected query: ${query}`));
    return Promise.resolve(match[1]);
  }) as unknown as FakeClient;
  client.end = vi.fn(async () => undefined);
  client.begin = vi.fn(async callback =>
    callback(client as unknown as postgres.TransactionSql)
  ) as FakeClient["begin"];
  return client;
}

describe("Supabase catalog reader", () => {
  it("keeps Edge settings defaults aligned with the application contract", () => {
    expect(CATALOG_DEFAULT_SETTINGS).toEqual(DEFAULT_SETTINGS);
  });

  it("reconnects once after a transient database connection failure", async () => {
    const clients = [
      clientFailing(
        Object.assign(new Error("connection ended"), {
          code: "CONNECTION_ENDED",
        })
      ),
      clientReturning([{ active: true, username: "admin", role: "admin" }]),
    ];
    const reader = createCatalogReader(
      "postgresql://reader@example.test/pos",
      () => clients.shift()!
    );

    await expect(
      reader.isActiveStaff({
        id: 7,
        username: "admin",
        role: "admin",
        branchId: 7,
      })
    ).resolves.toBe(true);
    expect(clients).toHaveLength(0);
  });

  it("does not reconnect for a deterministic query error", async () => {
    const clients = [
      clientFailing(
        Object.assign(new Error("permission denied"), {
          code: "42501",
        })
      ),
      clientReturning([{ active: true, username: "admin", role: "admin" }]),
    ];
    const reader = createCatalogReader(
      "postgresql://reader@example.test/pos",
      () => clients.shift()!
    );

    await expect(
      reader.isActiveStaff({
        id: 7,
        username: "admin",
        role: "admin",
        branchId: 7,
      })
    ).rejects.toThrow("permission denied");
    expect(clients).toHaveLength(1);
  });

  it("preserves the pump, refill, settings, and logo read contracts", async () => {
    const createdAt = new Date("2026-07-22T10:00:00.000Z");
    const reader = createCatalogReader(
      "postgresql://reader@example.test/pos",
      () =>
        clientMatching([
          ["from pos.pumps", [{ id: 1, name: "Pump 1", active: true }]],
          [
            "from pos.nozzles",
            [
              {
                id: 2,
                pumpId: 1,
                productId: 3,
                tankId: 4,
                label: "Nozzle 1",
                currentMeter: "12.5",
                currentMoney: "500.25",
                active: true,
              },
            ],
          ],
          [
            "from pos.products",
            [
              {
                id: 3,
                code: "GSH95",
                name: "Gasohol 95",
                category: "fuel",
                unit: "liter",
                price: "40.5",
                cost: "35.25",
                stockQty: "0",
                lowStockAt: "0",
                createdAt,
                active: true,
              },
            ],
          ],
          [
            "from pos.fuel_tanks",
            [
              {
                id: 4,
                productId: 3,
                name: "Tank 1",
                capacityLiters: "10000",
                currentLiters: "7500.5",
                lowAlertAt: "1000",
              },
            ],
          ],
          [
            "from pos.tank_refills",
            [
              {
                id: 5,
                tankId: 4,
                liters: "250.5",
                costPerLiter: "34.75",
                note: "delivery",
                createdAt,
              },
            ],
          ],
          [
            "and key <> 'shop_logo'",
            [{ key: "shop_name", value: "Production Station" }],
          ],
          ["and key = 'shop_logo'", [{ value: "data:image/png;base64,abc" }]],
        ])
    );

    await expect(reader.listPumps(7)).resolves.toEqual([
      {
        id: 1,
        name: "Pump 1",
        active: true,
        nozzles: [
          expect.objectContaining({
            id: 2,
            currentMeter: 12.5,
            currentMoney: 500.25,
            product: expect.objectContaining({ id: 3, price: 40.5 }),
            tank: expect.objectContaining({ id: 4, currentLiters: 7500.5 }),
          }),
        ],
      },
    ]);
    await expect(reader.listRefills(7)).resolves.toEqual([
      expect.objectContaining({
        id: 5,
        liters: 250.5,
        costPerLiter: 34.75,
        tank: expect.objectContaining({ id: 4, capacityLiters: 10000 }),
      }),
    ]);
    await expect(reader.getSettings(7)).resolves.toEqual(
      expect.objectContaining({
        shop_name: "Production Station",
        backup_auto_time: DEFAULT_SETTINGS.backup_auto_time,
      })
    );
    await expect(reader.getShopLogo(7)).resolves.toBe(
      "data:image/png;base64,abc"
    );
  });
});
