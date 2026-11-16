/** Códigos de barras de productos e insumos (inventario). */
import { all, get, run } from "./db";
import { productLabel, type Product } from "./types";

/** Limpia lo leído por la cámara o escrito a mano (sin espacios; máx. 64). */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/\s+/g, "").slice(0, 64);
}

export type BarcodeMatch = {
  item: string; // "product:12" o "supply:3"
  type: "product" | "supply";
  id: number;
  name: string;
  unit: string;
  qty: number;
  cost: number;
};

export async function findByBarcode(raw: string): Promise<BarcodeMatch | null> {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  const p = await get<Product>("SELECT * FROM products WHERE barcode = ? ORDER BY active DESC LIMIT 1", [code]);
  if (p) return { item: `product:${p.id}`, type: "product", id: p.id, name: productLabel(p), unit: "pza", qty: p.stock, cost: p.cost };
  const s = await get<{ id: number; name: string; unit: string; qty: number; cost_per_unit: number }>(
    "SELECT id, name, unit, qty, cost_per_unit FROM supplies WHERE barcode = ? LIMIT 1",
    [code],
  );
  if (s) return { item: `supply:${s.id}`, type: "supply", id: s.id, name: s.name, unit: s.unit, qty: s.qty, cost: s.cost_per_unit };
  return null;
}

/**
 * Asigna un código a un producto o insumo (lo quita de cualquier otro que lo tuviera).
 * A un producto además le activa el control de existencias.
 */
export async function assignBarcode(item: string, raw: string) {
  const code = normalizeBarcode(raw);
  const [type, idText] = item.split(":");
  const id = Math.round(Number(idText)) || 0;
  if (!code || !id) return;
  await run("UPDATE products SET barcode = '' WHERE barcode = ?", [code]);
  await run("UPDATE supplies SET barcode = '' WHERE barcode = ?", [code]);
  if (type === "supply") await run("UPDATE supplies SET barcode = ? WHERE id = ?", [code, id]);
  else await run("UPDATE products SET barcode = ?, track_stock = 1 WHERE id = ?", [code, id]);
}

/** Productos e insumos para elegir a cuál asignar un código nuevo. */
export async function barcodeTargets() {
  const [products, supplies] = await Promise.all([
    all<Product>("SELECT * FROM products WHERE active = 1 ORDER BY name, size"),
    all<{ id: number; name: string; unit: string }>("SELECT id, name, unit FROM supplies ORDER BY name"),
  ]);
  return [
    ...products.map((p) => ({ item: `product:${p.id}`, label: productLabel(p), group: "Productos del menú" })),
    ...supplies.map((s) => ({ item: `supply:${s.id}`, label: `${s.name} (${s.unit})`, group: "Insumos" })),
  ];
}
