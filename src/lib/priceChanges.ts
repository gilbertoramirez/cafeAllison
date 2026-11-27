/**
 * Cambios de precio programados: se guardan con fecha y se aplican solos cuando llega
 * (tarea diaria de Vercel y, de respaldo, al abrir la tienda, la caja o el menú).
 */
import { all, get, run, transaction } from "./db";
import { startOfLocalDay } from "./format";

export type PriceChange = {
  id: number;
  product_id: number | null;
  label: string;
  old_price: number | null;
  new_price: number | null;
  new_cost: number | null;
  effective_at: string;
  status: "pendiente" | "aplicado" | "cancelado" | "no_encontrado";
  applied_at: string | null;
  note: string;
  created_at: string;
  // del producto (solo al listar)
  current_price?: number | null;
  current_cost?: number | null;
};

const LABEL_SQL = "name || CASE WHEN size <> '' THEN ' (' || size || ')' ELSE '' END";

/**
 * Ajuste de precios de diciembre 2026 (propuesta basada en las ventas de noviembre).
 * [producto como aparece en el reporte, precio nuevo en pesos o null = igual, costo a registrar si no tiene]
 */
const DEC_2026: [string, number | null, number | null][] = [
  ["Malteada de Oreo (G 16oz)", 60, null],
  ["Galleta Navideña", 12, null],
  ["Frappé Clásico (G 16oz)", 60, null],
  ["Frappé de sabor (G 16oz)", 65, null],
  ["Malteada Chocolate (G 16oz)", 60, null],
  ["Malteada de Fresa (G 16oz)", 60, null],
  ["Chai (G 16oz)", 60, null],
  ["Chai (M 12oz)", 55, null],
  ["Frappé Oreo (G 16oz)", 90, null],
  ["Frappé tipo Magnum (G 16oz)", 90, null],
  ["Pan Pizza", 45, null],
  ["Browny", 50, null],
  ["Mega Rol", 50, null],
  ["Volován", 22, null],
  ["Galleta Estilo NY Pistache", 60, null],
  ["Galleta Estilo NY M&M's", 60, null],
  ["Galleta Estilo NY Red Velvet", 50, null],
  ["Coca Cola Original (500ml)", 28, null],
  ["Coca Cola Zero (500ml)", 28, null],
  ["Galleta casera", 28, null],
  ["Sándwich de Jamón de Pavo", 45, 26],
  // Combos
  ["Pan Pizza + Tisana", 80, 52],
  ["Pan Pizza + Coca 355ml", 65, 38],
  ["Sándwich + Coca 355ml", 65, 39],
  ["Pan Pizza + Soda Italiana", null, 38],
  ["Mega Rol + 2 cafés 16oz", null, 80],
];

/** Carga una sola vez la lista de diciembre (marca en settings para no repetirla). */
async function seedDecember() {
  const done = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'price_dec2026_v1'");
  if (done) return;
  await transaction(async (q) => {
    const [claimed] = await q<{ key: string }>(
      "INSERT INTO settings (key, value) VALUES ('price_dec2026_v1', '1') ON CONFLICT (key) DO NOTHING RETURNING key",
    );
    if (!claimed) return; // otra instancia ya la cargó
    const when = startOfLocalDay("2026-12-01");
    const now = new Date().toISOString();
    for (const [label, price, cost] of DEC_2026) {
      const matches = await q<{ id: number }>(
        `SELECT id FROM products WHERE lower(trim(${LABEL_SQL})) = lower(trim(?)) ORDER BY active DESC, id`,
        [label],
      );
      const note = "Ajuste de diciembre (ventas de noviembre)";
      if (!matches.length) {
        await q(
          "INSERT INTO price_changes (product_id, label, new_price, new_cost, effective_at, status, note, created_at) VALUES (NULL,?,?,?,?,'no_encontrado',?,?)",
          [label, price == null ? null : price * 100, cost == null ? null : cost * 100, when, note, now],
        );
        continue;
      }
      for (const m of matches)
        await q(
          "INSERT INTO price_changes (product_id, label, new_price, new_cost, effective_at, status, note, created_at) VALUES (?,?,?,?,?,'pendiente',?,?)",
          [m.id, label, price == null ? null : price * 100, cost == null ? null : cost * 100, when, note, now],
        );
    }
  });
}

/** Aplica los cambios cuya fecha ya llegó. Devuelve cuántos aplicó. Seguro de llamar muchas veces. */
export async function applyDuePriceChanges(): Promise<number> {
  try {
    await seedDecember();
    const nowIso = new Date().toISOString();
    const due = await all<PriceChange>(
      "SELECT * FROM price_changes WHERE status = 'pendiente' AND effective_at <= ? ORDER BY effective_at, id",
      [nowIso],
    );
    let applied = 0;
    for (const c of due) {
      await transaction(async (q) => {
        // Solo una instancia lo aplica aunque corran al mismo tiempo
        const [mine] = await q<{ id: number }>(
          "UPDATE price_changes SET status = 'aplicado', applied_at = ? WHERE id = ? AND status = 'pendiente' RETURNING id",
          [nowIso, c.id],
        );
        if (!mine) return;
        const [p] = await q<{ price: number; cost: number }>("SELECT price, cost FROM products WHERE id = ? FOR UPDATE", [c.product_id]);
        if (!p) {
          await q("UPDATE price_changes SET status = 'no_encontrado' WHERE id = ?", [c.id]);
          return;
        }
        await q("UPDATE price_changes SET old_price = ? WHERE id = ?", [p.price, c.id]);
        if (c.new_price != null) await q("UPDATE products SET price = ? WHERE id = ?", [c.new_price, c.product_id]);
        // El costo solo se llena si el producto no tenía (no pisa un costo real)
        if (c.new_cost != null && Number(p.cost) === 0) await q("UPDATE products SET cost = ? WHERE id = ?", [c.new_cost, c.product_id]);
        applied++;
      });
    }
    return applied;
  } catch (e) {
    console.error("precios programados", e);
    return 0;
  }
}

export async function listPriceChanges(): Promise<PriceChange[]> {
  await seedDecember().catch((e) => console.error("precios programados", e));
  return all<PriceChange>(
    `SELECT c.*, p.price AS current_price, p.cost AS current_cost FROM price_changes c
     LEFT JOIN products p ON p.id = c.product_id
     ORDER BY CASE c.status WHEN 'pendiente' THEN 0 WHEN 'no_encontrado' THEN 1 ELSE 2 END, c.effective_at DESC, c.label
     LIMIT 120`,
  );
}

/** Programa (o reemplaza) el precio nuevo de un producto a partir de un día. */
export async function schedulePriceChange(productId: number, newPrice: number, day: string, note = "") {
  const p = await get<{ name: string; size: string }>("SELECT name, size FROM products WHERE id = ?", [productId]);
  if (!p) return;
  await run("UPDATE price_changes SET status = 'cancelado' WHERE product_id = ? AND status = 'pendiente'", [productId]);
  await run(
    "INSERT INTO price_changes (product_id, label, new_price, effective_at, status, note, created_at) VALUES (?,?,?,?,'pendiente',?,?)",
    [productId, p.size ? `${p.name} (${p.size})` : p.name, newPrice, startOfLocalDay(day), note, new Date().toISOString()],
  );
}

export async function cancelPriceChange(id: number) {
  await run("UPDATE price_changes SET status = 'cancelado' WHERE id = ? AND status = 'pendiente'", [id]);
}
