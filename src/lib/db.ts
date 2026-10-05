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
  const pool: Pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
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

// Menú de ejemplo (precios en centavos). Se puede editar desde Admin > Menú.
const SEED_PRODUCTS: [string, string, string, number, number, number, number][] = [
  // name, description, category, price, cost, track_stock, stock
  ["Espresso", "Shot doble de café de especialidad", "Café caliente", 3500, 800, 0, 0],
  ["Americano", "Espresso con agua caliente, 12 oz", "Café caliente", 4000, 900, 0, 0],
  ["Capuchino", "Espresso, leche vaporizada y espuma, 12 oz", "Café caliente", 5500, 1500, 0, 0],
  ["Latte", "Espresso con leche vaporizada, 12 oz", "Café caliente", 5500, 1500, 0, 0],
  ["Mocha", "Latte con chocolate", "Café caliente", 6000, 1800, 0, 0],
  ["Frappé de café", "Café, leche, hielo y crema batida, 16 oz", "Bebidas frías", 7000, 2200, 0, 0],
  ["Cold brew", "Café extraído en frío por 18 h, 16 oz", "Bebidas frías", 6000, 1500, 0, 0],
  ["Chai latte", "Té chai especiado con leche", "Té y otros", 5500, 1600, 0, 0],
  ["Chocolate caliente", "Chocolate de mesa con leche", "Té y otros", 5000, 1400, 0, 0],
  ["Croissant", "Croissant de mantequilla", "Panadería", 4000, 1500, 1, 20],
  ["Concha", "Pan dulce tradicional", "Panadería", 2500, 800, 1, 20],
  ["Galleta de chispas", "Galleta grande de chocolate", "Panadería", 3000, 900, 1, 20],
  ["Sándwich de pavo", "Pan artesanal, pavo, queso panela, vegetales", "Comida", 8500, 3500, 1, 10],
  ["Chilaquiles", "Verdes o rojos, con crema, queso y huevo", "Comida", 9500, 3500, 0, 0],
];

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
    const [{ n }] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM products");
    if (n === 0) {
      for (const [i, [name, description, category, price, cost, track, stock]] of SEED_PRODUCTS.entries()) {
        await q(
          "INSERT INTO products (name, description, category, price, cost, track_stock, stock, min_stock, sort) VALUES (?,?,?,?,?,?,?,?,?)",
          [name, description, category, price, cost, track, stock, track ? 5 : 0, i],
        );
      }
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
