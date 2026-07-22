import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

export type CatalogReadResult = {
  isActiveStaff: (staff: StaffIdentity) => Promise<boolean>;
  listProducts: () => Promise<unknown>;
  listPumps: () => Promise<unknown>;
  listTanks: () => Promise<unknown>;
  listRefills: () => Promise<unknown>;
  lowStockAlerts: () => Promise<unknown>;
  priceHistory: (productId: number) => Promise<unknown>;
  getSettings: () => Promise<unknown>;
  getShopLogo: () => Promise<unknown>;
};

export type StaffIdentity = {
  id: number;
  username: string;
  role: "admin" | "manager" | "cashier";
};

type TankRow = {
  id: number;
  productId: number;
  name: string;
  capacityLiters: number;
  currentLiters: number;
  lowAlertAt: number;
};

type ProductRow = {
  id: number;
  code: string;
  name: string;
  category: "fuel" | "lubricant" | "other";
  unit: string;
  price: number;
  cost: number;
  stockQty: number;
  lowStockAt: number;
  createdAt: Date;
  active: boolean;
};

type PumpRow = {
  id: number;
  name: string;
  active: boolean;
};

type NozzleRow = {
  id: number;
  pumpId: number;
  productId: number;
  tankId: number | null;
  label: string;
  currentMeter: number;
  currentMoney: number;
  active: boolean;
};

type RefillRow = {
  id: number;
  tankId: number;
  liters: number;
  costPerLiter: number;
  note: string | null;
  createdAt: Date;
};

type PriceChangeRow = {
  id: number;
  productId: number | null;
  productCode: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;
  createdAt: Date;
};

// Keep this in lockstep with web/contracts/settings.ts. The parity test fails
// if either side changes without updating the other deployment surface.
export const CATALOG_DEFAULT_SETTINGS: Readonly<Record<string, string>> = {
  shop_name:
    "\u0e1b\u0e31\u0e4a\u0e21\u0e19\u0e49\u0e33\u0e21\u0e31\u0e19\u0e01\u0e25\u0e32\u0e07\u0e43\u0e2b\u0e0d\u0e48\u0e1a\u0e23\u0e34\u0e01\u0e32\u0e23",
  shop_branch: "\u0e2a\u0e32\u0e02\u0e32\u0e2b\u0e25\u0e31\u0e01",
  shop_address:
    "123 \u0e16.\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07 \u0e15.\u0e43\u0e19\u0e40\u0e21\u0e37\u0e2d\u0e07 \u0e2d.\u0e40\u0e21\u0e37\u0e2d\u0e07 \u0e08.\u0e02\u0e2d\u0e19\u0e41\u0e01\u0e48\u0e19 40000",
  tax_id: "0105566001123",
  shop_phone: "02-123-4567",
  vat_rate: "7",
  point_earn_per_baht: "25",
  point_redeem_value: "1",
  receipt_prefix: "R",
  receipt_next_no: "1",
  tax_invoice_prefix: "T",
  tax_invoice_next_no: "1",
  receipt_paper_size: "80",
  tax_invoice_paper_size: "a4",
  receipt_silent_print: "0",
  lan_enabled: "0",
  backup_auto_enabled: "0",
  backup_auto_time: "23:30",
  backup_auto_keep: "7",
};

function toNumber(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

const RETRYABLE_CONNECTION_CODES = new Set([
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CLOSED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

function isRetryableConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return RETRYABLE_CONNECTION_CODES.has(code) || code.startsWith("08");
}

function parseTankDisplayOrder(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is number =>
            typeof id === "number" && Number.isInteger(id) && id > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

function createClient(connectionString: string): SqlClient {
  // Transaction-mode poolers do not support prepared statements. Keep the
  // pool tiny because an Edge worker may be replicated across many regions.
  return postgres(connectionString, {
    prepare: false,
    ssl: "require",
    max: 1,
    // Edge workers scale out quickly. Releasing an idle transaction-pooler
    // client promptly avoids exhausting the reader role across warm workers.
    idle_timeout: 2,
    connect_timeout: 8,
  });
}

export function createCatalogReader(
  connectionString: string,
  clientFactory: (connectionString: string) => SqlClient = createClient,
): CatalogReadResult {
  if (!connectionString.trim()) {
    throw new Error("SUPABASE_DB_URL is required for the catalog reader");
  }

  let client: SqlClient | undefined;
  const getClient = () => {
    client ??= clientFactory(connectionString);
    return client;
  };

  const resetClient = async () => {
    const previous = client;
    client = undefined;
    if (previous) {
      try {
        await previous.end({ timeout: 1 });
      } catch {
        // The failed connection is already unusable; the next attempt creates
        // a fresh pooler connection.
      }
    }
  };

  const read = async <T>(operation: (sql: SqlClient) => Promise<T>) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await operation(getClient());
      } catch (error) {
        lastError = error;
        if (attempt === 1 || !isRetryableConnectionError(error)) break;
        await resetClient();
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Catalog database read failed");
  };

  const isActiveStaff = async (staff: StaffIdentity) => {
    const rows = await read((sql) =>
      sql<{
        active: boolean;
        username: string;
        role: StaffIdentity["role"];
      }[]>`
        select active, username, role
        from pos.staff_users
        where id = ${staff.id}
        limit 1
      `
    );
    const row = rows[0];
    return Boolean(
      row?.active && row.username === staff.username && row.role === staff.role,
    );
  };

  const listProducts = async () => {
    return read(async (sql) => {
      const rows = await sql<ProductRow[]>`
        select
          id,
          code,
          name,
          category,
          unit,
          price::double precision as price,
          cost::double precision as cost,
          stock_qty::double precision as "stockQty",
          low_stock_at::double precision as "lowStockAt",
          created_at as "createdAt",
          active
        from pos.products
        order by category asc, id asc
        limit 1000
      `;
      return rows.map((product) => ({
        ...product,
        price: toNumber(product.price),
        cost: toNumber(product.cost),
        stockQty: toNumber(product.stockQty),
        lowStockAt: toNumber(product.lowStockAt),
      }));
    });
  };

  const priceHistory = async (productId: number) => {
    return read(async (sql) => {
      const rows = await sql<PriceChangeRow[]>`
        select
          id,
          product_id as "productId",
          product_code as "productCode",
          product_name as "productName",
          old_price::double precision as "oldPrice",
          new_price::double precision as "newPrice",
          changed_by as "changedBy",
          created_at as "createdAt"
        from pos.price_changes
        where product_id = ${productId}
        order by created_at desc, id desc
        limit 50
      `;
      return rows.map((change) => ({
        ...change,
        oldPrice: toNumber(change.oldPrice),
        newPrice: toNumber(change.newPrice),
      }));
    });
  };

  const listPumps = async () => {
    return read(async (sql) => {
      const [pumpRows, nozzleRows, productRows, tankRows] = await Promise.all([
        sql<PumpRow[]>`
          select id, name, active
          from pos.pumps
          order by id asc
          limit 1000
        `,
        sql<NozzleRow[]>`
          select
            id,
            pump_id as "pumpId",
            product_id as "productId",
            tank_id as "tankId",
            label,
            current_meter::double precision as "currentMeter",
            current_money::double precision as "currentMoney",
            active
          from pos.nozzles
          order by id asc
          limit 1000
        `,
        sql<ProductRow[]>`
          select
            id,
            code,
            name,
            category,
            unit,
            price::double precision as price,
            cost::double precision as cost,
            stock_qty::double precision as "stockQty",
            low_stock_at::double precision as "lowStockAt",
            created_at as "createdAt",
            active
          from pos.products
          limit 1000
        `,
        sql<TankRow[]>`
          select
            id,
            product_id as "productId",
            name,
            capacity_liters::double precision as "capacityLiters",
            current_liters::double precision as "currentLiters",
            low_alert_at::double precision as "lowAlertAt"
          from pos.fuel_tanks
          limit 1000
        `,
      ]);

      return pumpRows.map((pump) => ({
        ...pump,
        nozzles: nozzleRows
          .filter((nozzle) => nozzle.pumpId === pump.id)
          .map((nozzle) => ({
            ...nozzle,
            currentMeter: toNumber(nozzle.currentMeter),
            currentMoney: toNumber(nozzle.currentMoney),
            product: (() => {
              const product = productRows.find(
                (candidate) => candidate.id === nozzle.productId,
              );
              return product
                ? {
                    ...product,
                    price: toNumber(product.price),
                    cost: toNumber(product.cost),
                    stockQty: toNumber(product.stockQty),
                    lowStockAt: toNumber(product.lowStockAt),
                  }
                : null;
            })(),
            tank: (() => {
              const tank = tankRows.find(
                (candidate) => candidate.id === nozzle.tankId,
              );
              return tank
                ? {
                    ...tank,
                    capacityLiters: toNumber(tank.capacityLiters),
                    currentLiters: toNumber(tank.currentLiters),
                    lowAlertAt: toNumber(tank.lowAlertAt),
                  }
                : null;
            })(),
          })),
      }));
    });
  };

  const listTanks = async () => {
    return read(async (sql) => {
      const [tankRows, productRows, nozzleRows, settingRows] = await Promise
        .all([
          sql<TankRow[]>`
        select
          id,
          product_id as "productId",
          name,
          capacity_liters::double precision as "capacityLiters",
          current_liters::double precision as "currentLiters",
          low_alert_at::double precision as "lowAlertAt"
        from pos.fuel_tanks
        limit 1000
      `,
          sql<ProductRow[]>`
        select
          id,
          code,
          name,
          category,
          unit,
          price::double precision as price,
          cost::double precision as cost,
          stock_qty::double precision as "stockQty",
          low_stock_at::double precision as "lowStockAt",
          created_at as "createdAt",
          active
        from pos.products
        limit 1000
      `,
          sql<NozzleRow[]>`
        select id, tank_id as "tankId"
        from pos.nozzles
        limit 1000
      `,
          sql<{ value: string }[]>`
        select value
        from pos.settings
        where key = 'tank_display_order'
        limit 1
      `,
        ]);

      const firstNozzleByTank = new Map<number, number>();
      for (const nozzle of nozzleRows) {
        if (nozzle.tankId == null) continue;
        const current = firstNozzleByTank.get(nozzle.tankId);
        if (current == null || nozzle.id < current) {
          firstNozzleByTank.set(nozzle.tankId, nozzle.id);
        }
      }

      const displayOrder = parseTankDisplayOrder(settingRows[0]?.value);
      const displayIndex = new Map(
        displayOrder.map((tankId, index) => [tankId, index]),
      );

      return tankRows
        .map((tank) => ({
          ...tank,
          capacityLiters: toNumber(tank.capacityLiters),
          currentLiters: toNumber(tank.currentLiters),
          lowAlertAt: toNumber(tank.lowAlertAt),
        }))
        .sort((a, b) => {
          const savedA = displayIndex.get(a.id);
          const savedB = displayIndex.get(b.id);
          if (savedA != null && savedB != null) return savedA - savedB;
          if (savedA != null) return -1;
          if (savedB != null) return 1;
          return (
            (firstNozzleByTank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (firstNozzleByTank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
            a.id - b.id
          );
        })
        .map((tank) => {
          const product = productRows.find((row) => row.id === tank.productId);
          return {
            ...tank,
            product: product
              ? {
                ...product,
                price: toNumber(product.price),
                cost: toNumber(product.cost),
                stockQty: toNumber(product.stockQty),
                lowStockAt: toNumber(product.lowStockAt),
              }
              : null,
            percent: Math.round(
              (tank.currentLiters / Math.max(tank.capacityLiters, 1)) * 100,
            ),
            isLow: tank.currentLiters <= tank.lowAlertAt,
          };
        });
    });
  };

  const listRefills = async () => {
    return read(async (sql) => {
      const [refillRows, tankRows] = await Promise.all([
        sql<RefillRow[]>`
          select
            id,
            tank_id as "tankId",
            liters::double precision as liters,
            cost_per_liter::double precision as "costPerLiter",
            note,
            created_at as "createdAt"
          from pos.tank_refills
          order by created_at desc
          limit 30
        `,
        sql<TankRow[]>`
          select
            id,
            product_id as "productId",
            name,
            capacity_liters::double precision as "capacityLiters",
            current_liters::double precision as "currentLiters",
            low_alert_at::double precision as "lowAlertAt"
          from pos.fuel_tanks
          limit 1000
        `,
      ]);

      return refillRows.map((refill) => {
        const tank = tankRows.find(
          (candidate) => candidate.id === refill.tankId,
        );
        return {
          ...refill,
          liters: toNumber(refill.liters),
          costPerLiter: toNumber(refill.costPerLiter),
          tank: tank
            ? {
                ...tank,
                capacityLiters: toNumber(tank.capacityLiters),
                currentLiters: toNumber(tank.currentLiters),
                lowAlertAt: toNumber(tank.lowAlertAt),
              }
            : null,
        };
      });
    });
  };

  const getSettings = async () => {
    return read(async (sql) => {
      const rows = await sql<{ key: string; value: string }[]>`
        select key, value
        from pos.settings
        where key <> 'shop_logo'
        limit 1000
      `;
      return {
        ...CATALOG_DEFAULT_SETTINGS,
        ...Object.fromEntries(rows.map((row) => [row.key, row.value])),
      };
    });
  };

  const getShopLogo = async () => {
    return read(async (sql) => {
      const rows = await sql<{ value: string }[]>`
        select value
        from pos.settings
        where key = 'shop_logo'
        limit 1
      `;
      return rows[0]?.value || null;
    });
  };

  const lowStockAlerts = async () => {
    return read(async (sql) => {
      const [tankRows, productRows] = await Promise.all([
        sql<TankRow[]>`
        select
          id,
          product_id as "productId",
          name,
          capacity_liters::double precision as "capacityLiters",
          current_liters::double precision as "currentLiters",
          low_alert_at::double precision as "lowAlertAt"
        from pos.fuel_tanks
        limit 1000
      `,
        sql<
          Pick<
            ProductRow,
            | "id"
            | "name"
            | "unit"
            | "stockQty"
            | "lowStockAt"
            | "active"
            | "category"
          >[]
        >`
        select
          id,
          name,
          unit,
          stock_qty::double precision as "stockQty",
          low_stock_at::double precision as "lowStockAt",
          active,
          category
        from pos.products
        limit 1000
      `,
      ]);

      const lowTanks = tankRows
        .map((tank) => ({
          ...tank,
          capacityLiters: toNumber(tank.capacityLiters),
          currentLiters: toNumber(tank.currentLiters),
          lowAlertAt: toNumber(tank.lowAlertAt),
        }))
        .filter((tank) => tank.currentLiters <= tank.lowAlertAt)
        .map((tank) => ({
          id: tank.id,
          name: tank.name,
          currentLiters: tank.currentLiters,
          capacityLiters: tank.capacityLiters,
          lowAlertAt: tank.lowAlertAt,
        }));

      const lowProducts = productRows
        .map((product) => ({
          ...product,
          stockQty: toNumber(product.stockQty),
          lowStockAt: toNumber(product.lowStockAt),
        }))
        .filter(
          (product) =>
            product.active &&
            product.category !== "fuel" &&
            product.stockQty <= product.lowStockAt,
        )
        .map((product) => ({
          id: product.id,
          name: product.name,
          unit: product.unit,
          stockQty: product.stockQty,
          lowStockAt: product.lowStockAt,
        }));

      return {
        lowTanks,
        lowProducts,
        count: lowTanks.length + lowProducts.length,
      };
    });
  };

  return {
    isActiveStaff,
    listProducts,
    listPumps,
    listTanks,
    listRefills,
    lowStockAlerts,
    priceHistory,
    getSettings,
    getShopLogo,
  };
}
