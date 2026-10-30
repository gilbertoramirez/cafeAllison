import { NextResponse } from "next/server";
import { getOrderByToken, getOrderItems, setOrderStatus } from "@/lib/orders";
import { expireCheckoutSession, refreshStripeOrder } from "@/lib/payments";

/**
 * El cliente decide no pagar en línea: se cancela el pedido que esperaba pago, se cierra la página
 * de Stripe, regresan las existencias y se devuelven los productos para rehacer el carrito.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[token]/cancelar">) {
  const { token } = await ctx.params;
  let order = await getOrderByToken(token);
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  await refreshStripeOrder(order); // si alcanzó a pagar, no se cancela
  order = (await getOrderByToken(token))!;
  const items = await getOrderItems(order.id);
  const cart = items.map((i) => ({ productId: i.product_id, qty: i.qty, note: i.notes }));
  if (order.status === "cancelado") return NextResponse.json({ ok: true, cart });
  if (order.status !== "pago_pendiente" || order.payment_status === "pagado") {
    return NextResponse.json({ error: "Este pedido ya se pagó.", paid: true }, { status: 409 });
  }
  await expireCheckoutSession(order.stripe_session_id);
  await setOrderStatus(order.id, "cancelado", "El cliente no completó el pago en línea");
  return NextResponse.json({ ok: true, cart });
}
