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
ALTER TABLE products ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '';
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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS postal_code TEXT NOT NULL DEFAULT '';
CREATE SEQUENCE IF NOT EXISTS orders_change_seq;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_seq BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_change ON orders(change_seq);
CREATE TABLE IF NOT EXISTS delivery_zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  postal_codes TEXT NOT NULL DEFAULT '',
  fee INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
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
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
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
type SeedItem = {
  name: string;
  category: string;
  icon: string;
  description?: string;
  sizes: [string, number][];
  days?: string;
  inactive?: boolean;
  /** Nombres anteriores, para conservar costos/existencias al renombrar */
  was?: string[];
};
const FLAVOR = "Elige tu sabor favorito.";
const OLD_FLAVOR = "Indica el sabor en las notas del pedido.";
const CH = "CH 8oz";
const M = "M 12oz";
const G = "G 16oz";
const HOT = "Bebidas Calientes";
const HOT_NC = "Calientes Sin Café";
const COLD = "Bebidas Frías";
const FRAPPE = "Frappés Especiales";
const SHAKE = "Malteadas";
const SNACK = "Snacks";
const SPECIAL = "Snacks Especiales";
const DESSERT = "Postres";
const COMBO = "Combos";
const MENU: SeedItem[] = [
  // Bebidas calientes
  { category: HOT, icon: "☕", name: "Espresso", sizes: [["", 25]] },
  { category: HOT, icon: "☕", name: "Americano", sizes: [["", 30]] },
  { category: HOT, icon: "☕", name: "Capuchino Clásico", sizes: [[CH, 40], [M, 45], [G, 50]] },
  { category: HOT, icon: "🍯", name: "Capuchino de sabor", description: FLAVOR, sizes: [[CH, 45], [M, 50], [G, 55]] },
  { category: HOT, icon: "🥛", name: "Latte Clásico", sizes: [[CH, 55], [M, 55], [G, 55]] },
  { category: HOT, icon: "🍮", name: "Latte de sabor", description: FLAVOR, sizes: [[CH, 55], [M, 55], [G, 55]] },
  { category: HOT, icon: "🍫", name: "Capuchino Moka", sizes: [[CH, 45], [M, 50], [G, 55]] },
  // Calientes sin café
  { category: HOT_NC, icon: "🍫", name: "Chocolate", sizes: [[CH, 35], [M, 40], [G, 45]] },
  { category: HOT_NC, icon: "🫖", name: "Chai", sizes: [[CH, 45], [M, 50], [G, 55]] },
  { category: HOT_NC, icon: "🌺", name: "Tisana", description: FLAVOR, sizes: [[M, 40], [G, 50]], was: ["Tisana Frutal caliente"] },
  // Bebidas frías (16oz)
  { category: COLD, icon: "🧊", name: "Iced Capuchino Clásico", sizes: [[G, 50]] },
  { category: COLD, icon: "🧋", name: "Iced Capuchino de sabor", description: FLAVOR, sizes: [[G, 55]] },
  { category: COLD, icon: "🥛", name: "Iced Latte Clásico", sizes: [[G, 50]], was: ["Latte Clásico frío"] },
  { category: COLD, icon: "🧋", name: "Iced Latte de sabor", description: FLAVOR, sizes: [[G, 55]], was: ["Latte frío de sabor"] },
  { category: COLD, icon: "🥤", name: "Frappé Clásico", sizes: [[G, 55]] },
  { category: COLD, icon: "🥤", name: "Frappé de sabor", description: FLAVOR, sizes: [[G, 60]] },
  { category: COLD, icon: "🍹", name: "Tisana Frutal", description: FLAVOR, sizes: [[G, 50]], was: ["Tisana Frutal fría"] },
  { category: COLD, icon: "🫧", name: "Soda Italiana", description: FLAVOR, sizes: [[G, 55]] },
  // Frappés especiales
  { category: FRAPPE, icon: "🍰", name: "Frappé Gansito", sizes: [[G, 85]] },
  { category: FRAPPE, icon: "🍦", name: "Frappé tipo Magnum", sizes: [[G, 85]], was: ["Frappé Magnum"] },
  { category: FRAPPE, icon: "🍨", name: "Frappé Mordisco", sizes: [[G, 85]] },
  { category: FRAPPE, icon: "🐧", name: "Frappé Pingüino", sizes: [[G, 85]] },
  { category: FRAPPE, icon: "🍪", name: "Frappé Oreo", sizes: [[G, 85]] },
  // Malteadas
  { category: SHAKE, icon: "🍪", name: "Malteada de Oreo", sizes: [[G, 55]] },
  { category: SHAKE, icon: "🍓", name: "Malteada de Fresa", sizes: [[G, 55]] },
  // Snacks
  { category: SNACK, icon: "🥖", name: "Baguette de Pechuga de Pollo", sizes: [["", 85]] },
  { category: SNACK, icon: "🥖", name: "Baguette de Jamón de Pavo", sizes: [["", 65]] },
  { category: SNACK, icon: "🥪", name: "Sándwich de Pechuga de Pollo", sizes: [["", 70]] },
  { category: SNACK, icon: "🥪", name: "Sándwich de Jamón de Pavo", sizes: [["", 40]] },
  { category: SNACK, icon: "🍕", name: "Pan Pizza", sizes: [["", 40]] },
  // Snacks especiales: viernes (5) y sábado (6)
  { category: SPECIAL, icon: "🍗", name: "Boneless", description: "Individual (250 gramos). Viernes y sábados.", sizes: [["", 100]], days: "5,6" },
  { category: SPECIAL, icon: "🍿", name: "Palomitas de pollo", description: "Individual (250 gramos). Viernes y sábados.", sizes: [["", 110]], days: "5,6" },
  // Postres
  { category: DESSERT, icon: "🍥", name: "Rol individual", sizes: [["", 35]], was: ["Rol Maple Individual"] },
  { category: DESSERT, icon: "🍥", name: "Mega Rol", sizes: [["", 45]] },
  { category: DESSERT, icon: "🥐", name: "Volován", sizes: [["", 20]] },
  { category: DESSERT, icon: "🍞", name: "Pan de muerto", sizes: [["", 35]] },
  { category: DESSERT, icon: "🍞", name: "Pan de muerto relleno", sizes: [["", 45]] },
  { category: DESSERT, icon: "🍪", name: "Galleta Estilo NY Clásica", sizes: [["", 45]], was: ["Galleta Estilo NY"] },
  { category: DESSERT, icon: "🍪", name: "Galleta Estilo NY de sabor", description: FLAVOR, sizes: [["", 50]] },
  { category: DESSERT, icon: "🍪", name: "Galleta de avena", sizes: [["", 7]] },
  { category: DESSERT, icon: "🍪", name: "Galleta casera", sizes: [["", 25]], was: ["Galleta Casera"] },
  { category: DESSERT, icon: "🍪", name: "Galleta nutri", sizes: [["", 25]] },
  // Sin precio en la hoja: queda oculta hasta que se le ponga precio en Admin > Menú
  { category: DESSERT, icon: "🌾", name: "Barra Power Max", sizes: [["", 0]], inactive: true },
  { category: DESSERT, icon: "🍫", name: "Barra Browny", sizes: [["", 15]] },
  { category: DESSERT, icon: "🍫", name: "Barra Browny zero", sizes: [["", 15]] },
  { category: DESSERT, icon: "🍫", name: "Browny", sizes: [["", 45]] },
  { category: DESSERT, icon: "🍨", name: "Affogato", sizes: [["", 45]] },
  // Combos
  { category: COMBO, icon: "🍕", name: "Pan Pizza + Coca 355ml", sizes: [["", 60]] },
  { category: COMBO, icon: "🍕", name: "Pan Pizza + Tisana", sizes: [["", 75]] },
  { category: COMBO, icon: "🍕", name: "Pan Pizza + Soda Italiana", sizes: [["", 85]] },
  { category: COMBO, icon: "🥪", name: "Sándwich + Coca 355ml", sizes: [["", 60]] },
  { category: COMBO, icon: "🥪", name: "Sándwich + Tisana", sizes: [["", 75]] },
  { category: COMBO, icon: "🥪", name: "Sándwich + Soda Italiana", sizes: [["", 85]] },
  { category: COMBO, icon: "🍥", name: "Rol individual + Café 16oz", sizes: [["", 80]] },
  { category: COMBO, icon: "🍥", name: "Mega Rol + 2 cafés 16oz", sizes: [["", 140]] },
];
const MENU_VERSION = "allison-2";

type Q = Query;

/**
 * Sincroniza el menú sin perder historial: actualiza precio/categoría/ícono de los productos
 * existentes (conserva costo, existencias y foto), agrega los nuevos y oculta los que ya no están.
 */
async function syncMenu(q: Q) {
  const existing = await q<{ id: number; name: string; size: string }>("SELECT id, name, size FROM products");
  const norm = (x: string) => x.trim().toLowerCase();
  const byKey = new Map(existing.map((p) => [`${norm(p.name)}|${norm(p.size)}`, p.id]));
  const keep: number[] = [];
  let sort = 0;
  for (const item of MENU) {
    for (const [size, pesos] of item.sizes) {
      // Si el producto se vendía con otro tamaño (p.ej. Espresso "CH 8oz" → sin tamaño), también lo reconoce
      const candidates = [item.name, ...(item.was ?? [])].flatMap((n) => [
        `${norm(n)}|${norm(size)}`,
        ...(item.sizes.length === 1 ? existing.filter((e) => norm(e.name) === norm(n)).map((e) => `${norm(e.name)}|${norm(e.size)}`) : []),
      ]);
      const id = candidates.map((k) => byKey.get(k)).find((v) => v !== undefined && !keep.includes(v));
      const values = [item.name, size, item.category, item.description ?? "", pesos * 100, item.days ?? "", item.icon, item.inactive ? 0 : 1, sort++];
      if (id !== undefined) {
        await q(
          `UPDATE products SET name=?, size=?, category=?, description=?, price=?, available_days=?, icon=?, active=?, sort=? WHERE id=?`,
          [...values, id],
        );
        keep.push(id);
      } else {
        const [row] = await q<{ id: number }>(
          `INSERT INTO products (name, size, category, description, price, available_days, icon, active, sort, cost)
           VALUES (?,?,?,?,?,?,?,?,?,0) RETURNING id`,
          values,
        );
        keep.push(row.id);
      }
    }
  }
  if (keep.length) {
    await q(`UPDATE products SET active = 0 WHERE id NOT IN (${keep.map(() => "?").join(",")})`, keep);
  }
}

const DEFAULT_SETTINGS: Record<string, string> = {
  business_name: "Café Allison",
  whatsapp_number: "",
  delivery_enabled: "1",
  delivery_fee: "3000",
  min_delivery_order: "10000",
  free_delivery_from: "0",
  online_fee_enabled: "0",
  online_fee_percent: "3.6",
  online_fee_fixed: "300",
  online_fee_iva: "16",
  store_open: "1",
  address: "",
  hours: "Lun a Sáb 8:00 – 20:00",
};

async function init(b: Backend) {
  await b.transaction(async (q) => {
    // Evita que dos instancias creen las tablas al mismo tiempo
    await q("SELECT pg_advisory_xact_lock(7212026)");
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await q(stmt);
    // Actualiza el menú cuando cambia su versión (una sola vez)
    const [ver] = await q<{ value: string }>("SELECT value FROM settings WHERE key = 'menu_version'");
    if (ver?.value !== MENU_VERSION) {
      await syncMenu(q);
      await q(
        "INSERT INTO settings (key, value) VALUES ('menu_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [MENU_VERSION],
      );
    }
    await q("UPDATE products SET description = ? WHERE description = ?", [FLAVOR, OLD_FLAVOR]);
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
