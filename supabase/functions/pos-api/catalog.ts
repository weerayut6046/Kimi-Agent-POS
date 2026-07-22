import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

export type CatalogReadResult = {
  isActiveStaff: (staff: StaffIdentity) => Promise<boolean>;
  listProducts: () => Promise<unknown>;
  listTanks: () => Promise<unknown>;
  lowStockAlerts: () => Promise<unknown>;
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

  const isActiveStaff = async (staff: StaffIdentity) => {
    const rows = await getClient()<{
      active: boolean;
      username: string;
      role: StaffIdentity["role"];
    }[]>`
      select active, username, role
      from pos.staff_users
      where id = ${staff.id}
      limit 1
    `;
    const row = rows[0];
    return Boolean(
      row?.active && row.username === staff.username && row.role === staff.role,
    );
  };

  const listProducts = async () => {
    const rows = await getClient()<ProductRow[]>`
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
  };

  const listTanks = async () => {
    const sql = getClient();
    const [tankRows, productRows, nozzleRows, settingRows] = await Promise.all([
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
  };

  const lowStockAlerts = async () => {
    const sql = getClient();
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
  };

  return { isActiveStaff, listProducts, listTanks, lowStockAlerts };
}
