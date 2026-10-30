import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { itemsForOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Estado de los pedidos de este dispositivo (por sus tokens) para "Mis pedidos". */
export async function GET(req: Request) {
  const tokens = (new URL(req.url).searchParams.get("tokens") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^[\w-]{8,40}$/.test(t))
    .slice(0, 10);
  if (!tokens.length) return NextResponse.json({ orders: [] });
  const orders = await all<{
    id: number;
    token: string;
    status: string;
    payment_status: string;
    payment_method: string;
    delivery_type: string;
    total: number;
    created_at: string;
  }>(
    `SELECT id, token, status, payment_status, payment_method, delivery_type, total, created_at
     FROM orders WHERE token IN (${tokens.map(() => "?").join(",")}) ORDER BY created_at DESC`,
    tokens,
  );
  const items = await itemsForOrders(orders.map((o) => o.id));
  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      items: (items.get(o.id) ?? []).map((i) => ({ name: i.name, qty: i.qty })),
    })),
  });
}
