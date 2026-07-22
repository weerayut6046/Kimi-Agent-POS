import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

export type CatalogReadResult = {
  isActiveStaff: (staff: StaffIdentity) => Promise<boolean>;
  listProducts: () => Promise<unknown>;
  listTanks: () => Promise<unknown>;
  lowStockAlerts: () => Promise<unknown>;
  priceHistory: (productId: number) => Promise<unknown>;
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

type NozzleRow = { id: number; tankId: number | null };

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

function toNumber(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
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
    idle_timeout: 20,
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
        if (attempt === 1) break;
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
    listTanks,
    lowStockAlerts,
    priceHistory,
  };
}
