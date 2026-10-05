import { createClient, type Client, type InArgs, type Row } from "@libsql/client";

// Local: archivo SQLite (data/cafe.db). Producción: Turso (DATABASE_URL=libsql://... + DATABASE_AUTH_TOKEN).
// En Vercel sin DATABASE_URL se usa /tmp (único lugar con escritura), pero esos datos se pierden: solo sirve de demo.
const url = process.env.DATABASE_URL || (process.env.VERCEL ? "file:/tmp/cafe.db" : "file:data/cafe.db");

/** true cuando los datos no sobreviven a reinicios del servidor (Vercel sin Turso). */
export const isEphemeralDb = !process.env.DATABASE_URL && Boolean(process.env.VERCEL);

const globalForDb = globalThis as unknown as { __db?: Client; __dbReady?: Promise<void> };

function getClient(): Client {
  if (!globalForDb.__db) {
    if (url.startsWith("file:")) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path") as typeof import("node:path");
      fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
    }
    globalForDb.__db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  }
  return globalForDb.__db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS supplies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pza',
  qty REAL NOT NULL DEFAULT 0,
  min_qty REAL NOT NULL DEFAULT 0,
  cost_per_unit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  change REAL NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nuevo',
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  delivery_type TEXT NOT NULL DEFAULT 'mostrador',
  address TEXT NOT NULL DEFAULT '',
  address_ref TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  notes TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pendiente',
  cash_given INTEGER,
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  stripe_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pagado',
  recurring TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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

async function init() {
  const db = getClient();
  await db.executeMultiple(SCHEMA);
  const count = await db.execute("SELECT COUNT(*) AS n FROM products");
  if (Number(count.rows[0].n) === 0) {
    await db.batch(
      SEED_PRODUCTS.map(([name, description, category, price, cost, track, stock], i) => ({
        sql: "INSERT INTO products (name, description, category, price, cost, track_stock, stock, min_stock, sort) VALUES (?,?,?,?,?,?,?,?,?)",
        args: [name, description, category, price, cost, track, stock, track ? 5 : 0, i],
      })),
      "write",
    );
  }
  await db.batch(
    Object.entries(DEFAULT_SETTINGS).map(([k, v]) => ({
      sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
      args: [k, v],
    })),
    "write",
  );
}

export async function db(): Promise<Client> {
  if (!globalForDb.__dbReady) {
    globalForDb.__dbReady = init().catch((e) => {
      globalForDb.__dbReady = undefined;
      throw e;
    });
  }
  await globalForDb.__dbReady;
  return getClient();
}

export async function all<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const res = await (await db()).execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function get<T = Row>(sql: string, args: InArgs = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

export async function run(sql: string, args: InArgs = []) {
  return (await db()).execute({ sql, args });
}
