/** Sugerencias "¿Le agregas…?": qué se compra junto y qué es lo más vendido (por nombre de producto). */
import { all } from "./db";

export type UpsellData = {
  /** producto → productos que más se compran con él (de más a menos) */
  companions: Record<string, string[]>;
  /** productos más vendidos (de más a menos) */
  popular: string[];
};

export async function getUpsellData(days = 120): Promise<UpsellData> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const [pairs, top] = await Promise.all([
    all<{ a: string; b: string; n: number }>(
      `SELECT pa.name AS a, pb.name AS b, COUNT(DISTINCT x.order_id) AS n
       FROM order_items x
       JOIN order_items y ON y.order_id = x.order_id AND y.product_id <> x.product_id
       JOIN products pa ON pa.id = x.product_id
       JOIN products pb ON pb.id = y.product_id
       JOIN orders o ON o.id = x.order_id
       WHERE o.status <> 'cancelado' AND o.status <> 'pago_pendiente' AND o.created_at >= ? AND pa.name <> pb.name
       GROUP BY pa.name, pb.name
       HAVING COUNT(DISTINCT x.order_id) >= 2
       ORDER BY n DESC
       LIMIT 2000`,
      [since],
    ),
    all<{ name: string; n: number }>(
      `SELECT p.name, SUM(oi.qty) AS n
       FROM order_items oi JOIN products p ON p.id = oi.product_id JOIN orders o ON o.id = oi.order_id
       WHERE o.status <> 'cancelado' AND o.status <> 'pago_pendiente' AND o.created_at >= ?
       GROUP BY p.name ORDER BY n DESC LIMIT 60`,
      [since],
    ),
  ]);
  const companions: Record<string, string[]> = {};
  for (const p of pairs) {
    const list = (companions[p.a] ??= []);
    if (list.length < 6) list.push(p.b);
  }
  return { companions, popular: top.map((t) => t.name) };
}
