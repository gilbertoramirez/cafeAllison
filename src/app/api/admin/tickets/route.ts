import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { all } from "@/lib/db";
import { ticketsFor } from "@/lib/tickets-server";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Datos para imprimir tickets.
 *  ?ids=1,2      → esos pedidos
 *  ?after=15     → pedidos en línea confirmados después de la marca 15 (comandas automáticas)
 */
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
  const after = Number(url.searchParams.get("after"));

  let orders: Order[] = [];
  if (ids.length) {
    orders = await all<Order>(`SELECT * FROM orders WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids);
  } else if (Number.isInteger(after) && after >= 0) {
    // Solo pedidos recientes (últimas 2 h) para no imprimir pedidos viejos al abrir la tableta
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    orders = await all<Order>(
      `SELECT * FROM orders WHERE confirmed_seq > ? AND channel <> 'mostrador' AND status NOT IN ('cancelado','pago_pendiente')
         AND created_at >= ?
       ORDER BY confirmed_seq LIMIT 20`,
      [after, since],
    );
  }
  const tickets = await ticketsFor(orders);
  return NextResponse.json({ tickets });
}
