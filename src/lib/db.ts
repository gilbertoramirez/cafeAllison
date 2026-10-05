import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

/*
 * Base de datos Postgres.
 * - Producción (Vercel): Neon u otro Postgres vía DATABASE_URL (o POSTGRES_URL).
 * - Local sin DATABASE_URL: PGlite (Postgres embebido) guardado en data/pglite.
 * - Vercel sin DATABASE_URL: PGlite en /tmp — solo demo, los datos se pierden.
 */
const connectionString = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
const usePostgres = /^postgres(ql)?:\/\//.test(connectionString);

/** true cuando los datos no sobreviven a reinicios del servidor (Vercel sin Postgres). */
export const isEphemeralDb = !usePostgres && Boolean(process.env.VERCEL);
export const dbKind = usePostgres ? "postgres" : isEphemeralDb ? "pglite-temporal" : "pglite";

export type Params = unknown[];
export type Query = <T = Record<string, unknown>>(sql: string, params?: Params) => Promise<T[]>;

// COUNT/SUM devuelven bigint/numeric: los convertimos a number (montos en centavos caben de sobra).
const INT8 = 20;
const NUMERIC = 1700;

/** Permite escribir los parámetros como "?" y los convierte a $1, $2… */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

type Backend = {
  query: Query;
  transaction<T>(fn: (q: Query) => Promise<T>): Promise<T>;
};

const g = globalThis as unknown as { __cafeDb?: Promise<Backend> };

async function createPostgres(): Promise<Backend> {
  const pg = await import("pg");
  pg.types.setTypeParser(INT8, (v) => Number(v));
  pg.types.setTypeParser(NUMERIC, (v) => Number(v));
  const pool: Pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Neon incluye channel_binding=require en su cadena de conexión
    enableChannelBinding: /channel_binding=require/.test(connectionString),
  });
  // Un error en una conexión inactiva no debe tumbar el servidor
  pool.on("error", (e) => console.error("Postgres pool error", e));
  return {
    query: async (sql, params = []) => (await pool.query(toPg(sql), params)).rows,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(async (sql, params = []) => (await client.query(toPg(sql), params)).rows);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

async function createPglite(): Promise<Backend> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.VERCEL ? "/tmp/pglite" : process.env.PGLITE_DIR || "data/pglite";
  const fs = await import("node:fs");
  fs.mkdirSync(dataDir, { recursive: true });
  const parsers = { [INT8]: (v: string) => Number(v), [NUMERIC]: (v: string) => Number(v) };
  const pgl: PGlite = await PGlite.create({ dataDir, parsers });
  return {
    query: async (sql, params = []) => (await pgl.query(toPg(sql), params)).rows as never,
    transaction: (fn) =>
      pgl.transaction((tx) => fn(async (sql, params = []) => (await tx.query(toPg(sql), params)).rows as never)),
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  price INTEGER NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  track_stock INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS available_days TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS supplies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pza',
  qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  min_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_per_unit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id SERIAL PRIMARY KEY,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  change DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nuevo',
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  delivery_type TEXT NOT NULL DEFAULT 'mostrador',
  address TEXT NOT NULL DEFAULT '',
  address_ref TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notes TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pendiente',
  cash_given INTEGER,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  stripe_session_id TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pagado',
  recurring TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Menú de Café Allison (precios en pesos). Se puede editar desde Admin > Menú.
// Cada tamaño es un producto; la tienda los agrupa por nombre.
type SeedItem = { name: string; category: string; description?: string; sizes: [string, number][]; days?: string };
const FLAVOR = "Indica el sabor en las notas del pedido.";
const CH = "CH 8oz";
const M = "M 12oz";
const G = "G 16oz";
const MENU: SeedItem[] = [
  // Café
  { category: "Café", name: "Espresso", sizes: [[CH, 25]] },
  { category: "Café", name: "Americano", sizes: [[M, 30]] },
  { category: "Café", name: "Capuchino Clásico", sizes: [[CH, 40], [M, 45], [G, 50]] },
  { category: "Café", name: "Capuchino de sabor", description: FLAVOR, sizes: [[CH, 45], [M, 50], [G, 55]] },
  { category: "Café", name: "Latte Clásico", sizes: [[CH, 40], [M, 45], [G, 50]] },
  { category: "Café", name: "Latte de sabor", description: FLAVOR, sizes: [[CH, 45], [M, 50], [G, 55]] },
  // Sin café
  { category: "Sin Café", name: "Chocolate", sizes: [[CH, 35], [M, 40], [G, 45]] },
  { category: "Sin Café", name: "Tisana Frutal caliente", description: FLAVOR, sizes: [[M, 40], [G, 50]] },
  { category: "Sin Café", name: "Soda Italiana", description: FLAVOR, sizes: [[G, 55]] },
  // Barra fría
  { category: "Barra Fría", name: "Tisana Frutal fría", description: FLAVOR, sizes: [[M, 40], [G, 50]] },
  { category: "Barra Fría", name: "Latte Clásico frío", sizes: [[M, 45], [G, 50]] },
  { category: "Barra Fría", name: "Latte frío de sabor", description: FLAVOR, sizes: [[M, 50], [G, 55]] },
  { category: "Barra Fría", name: "Frappé Clásico", sizes: [[M, 50], [G, 55]] },
  { category: "Barra Fría", name: "Frappé de sabor", description: FLAVOR, sizes: [[M, 55], [G, 60]] },
  // Frappés especiales
  ...["Gansito", "Magnum", "Mordisco", "Oreo", "Pingüino"].map(
    (n): SeedItem => ({ category: "Frappés Especiales", name: `Frappé ${n}`, sizes: [[G, 85]] }),
  ),
  // Malteadas
  { category: "Malteadas", name: "Malteada de Oreo", sizes: [[G, 55]] },
  { category: "Malteadas", name: "Malteada de Fresa", sizes: [[G, 55]] },
  // Postres
  { category: "Postres", name: "Rol Maple Individual", sizes: [["", 35]] },
  { category: "Postres", name: "Mega Rol", sizes: [["", 45]] },
  { category: "Postres", name: "Volován", sizes: [["", 20]] },
  { category: "Postres", name: "Croissant dulce", sizes: [["", 35]] },
  { category: "Postres", name: "Galleta Estilo NY", sizes: [["", 45]] },
  { category: "Postres", name: "Galleta Casera", sizes: [["", 25]] },
  { category: "Postres", name: "Galletas de Mantequilla", description: "Bolsa con 6 galletas", sizes: [["", 50]] },
  { category: "Postres", name: "Galleta de avena", sizes: [["", 7]] },
  { category: "Postres", name: "Affogato", sizes: [["", 45]] },
  // Snacks
  { category: "Snacks", name: "Baguette de Pechuga de Pollo", sizes: [["", 85]] },
  { category: "Snacks", name: "Baguette de Jamón de Pavo", sizes: [["", 65]] },
  { category: "Snacks", name: "Sándwich de Pechuga de Pollo", sizes: [["", 70]] },
  { category: "Snacks", name: "Sándwich de Jamón de Pavo", sizes: [["", 40]] },
  { category: "Snacks", name: "Pan Pizza", sizes: [["", 40]] },
  // Combos
  { category: "Combos", name: "Pan Pizza + Coca 355ml", sizes: [["", 60]] },
  { category: "Combos", name: "Pan Pizza + Tisana", sizes: [["", 75]] },
  { category: "Combos", name: "Pan Pizza + Soda Italiana", sizes: [["", 85]] },
  { category: "Combos", name: "Rol individual + Café 16oz", sizes: [["", 80]] },
  { category: "Combos", name: "Mega Rol + 2 cafés 16oz", sizes: [["", 140]] },
  // Snacks especiales: viernes (5) y sábado (6)
  { category: "Snacks Especiales", name: "Boneless", description: "Individual (250 gramos). Viernes y sábados.", sizes: [["", 110]], days: "5,6" },
  { category: "Snacks Especiales", name: "Palomitas de pollo", description: "Individual (250 gramos). Viernes y sábados.", sizes: [["", 100]], days: "5,6" },
];
const MENU_VERSION = "allison-1";

const DEFAULT_SETTINGS: Record<string, string> = {
  business_name: "Café Allison",
  whatsapp_number: "",
  delivery_enabled: "1",
  delivery_fee: "3000",
  min_delivery_order: "10000",
  store_open: "1",
  address: "",
  hours: "Lun a Sáb 8:00 – 20:00",
};

async function init(b: Backend) {
  await b.transaction(async (q) => {
    // Evita que dos instancias creen las tablas al mismo tiempo
    await q("SELECT pg_advisory_xact_lock(7212026)");
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
    // Carga el menú de Café Allison si aún no se ha cargado y no hay ventas registradas
    const [ver] = await q<{ value: string }>("SELECT value FROM settings WHERE key = 'menu_version'");
    if (ver?.value !== MENU_VERSION) {
      const [{ n }] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM order_items");
      if (n === 0) {
        await q("DELETE FROM inventory_movements WHERE item_type = 'product'");
        await q("DELETE FROM products");
        let sort = 0;
        for (const item of MENU) {
          for (const [size, pesos] of item.sizes) {
            await q(
              "INSERT INTO products (name, size, description, category, price, cost, available_days, sort) VALUES (?,?,?,?,?,0,?,?)",
              [item.name, size, item.description ?? "", item.category, pesos * 100, item.days ?? "", sort++],
            );
          }
        }
      }
      await q(
        "INSERT INTO settings (key, value) VALUES ('menu_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [MENU_VERSION],
      );
    }
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await q("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", [k, v]);
    }
  });
}

async function backend(): Promise<Backend> {
  if (!g.__cafeDb) {
    g.__cafeDb = (async () => {
      const b = usePostgres ? await createPostgres() : await createPglite();
      await init(b);
      return b;
    })().catch((e) => {
      g.__cafeDb = undefined;
      throw e;
    });
  }
  return g.__cafeDb;
}

export async function all<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
  return (await backend()).query<T>(sql, params);
}

export async function get<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: Params = []): Promise<void> {
  await all(sql, params);
}

/** Ejecuta varias consultas de forma atómica. */
export async function transaction<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return (await backend()).transaction(fn);
}
