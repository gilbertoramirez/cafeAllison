import type Stripe from "stripe";
import { get, run } from "./db";
import { getOrderItems, markOrderPaid, orderCode, setOrderStatus } from "./orders";
import { getStripe } from "./stripe";
import type { Order } from "./types";

/** Crea (o vuelve a crear) la página de pago de Stripe para un pedido que espera pago. */
export async function createCheckoutSession(order: Order, businessName: string, base: string): Promise<string> {
  const items = await getOrderItems(order.id);
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    currency: "mxn",
    locale: "es",
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id) },
    line_items: [
      // las bebidas gratis ($0) no se mandan a Stripe
      ...items.filter((i) => i.unit_price > 0).map((i) => ({
        quantity: i.qty,
        price_data: {
          currency: "mxn",
          unit_amount: i.unit_price,
          product_data: { name: i.notes ? `${i.name} · ${i.notes}` : i.name },
        },
      })),
      ...(order.delivery_fee > 0
        ? [
            {
              quantity: 1,
              price_data: { currency: "mxn", unit_amount: order.delivery_fee, product_data: { name: "Envío a domicilio" } },
            },
          ]
        : []),
    ],
    payment_intent_data: { description: `${businessName} pedido ${orderCode(order.id)}` },
    success_url: `${base}/pedido/${order.token}?pago=ok`,
    cancel_url: `${base}/pedido/${order.token}?pago=cancelado`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min (mínimo de Stripe)
  });
  await run("UPDATE orders SET stripe_session_id = ? WHERE id = ?", [session.id, order.id]);
  if (!session.url) throw new Error("Stripe no devolvió la página de pago");
  return session.url;
}

/** Cierra una página de pago abierta para que ya no se pueda pagar. */
export async function expireCheckoutSession(sessionId: string | null) {
  if (!sessionId) return;
  try {
    const s = await getStripe().checkout.sessions.retrieve(sessionId);
    if (s.status === "open") await getStripe().checkout.sessions.expire(sessionId);
  } catch (e) {
    console.error("No se pudo expirar la sesión de Stripe", e);
  }
}

/** Aplica el resultado de una sesión de Stripe Checkout al pedido. Idempotente. */
export async function syncCheckoutSession(session: Stripe.Checkout.Session) {
  const order = await get<Order>("SELECT * FROM orders WHERE stripe_session_id = ?", [session.id]);
  if (!order) return;
  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    await markOrderPaid(order.id);
  } else if (session.status === "expired" && order.payment_status !== "pagado" && order.status === "pago_pendiente") {
    await setOrderStatus(order.id, "cancelado", "Pago en línea no completado");
  }
}

/** Revisa directamente con Stripe (útil si el webhook aún no llega). */
export async function refreshStripeOrder(order: Order) {
  if (!order.stripe_session_id || order.payment_status === "pagado" || order.status === "cancelado") return;
  try {
    const session = await getStripe().checkout.sessions.retrieve(order.stripe_session_id);
    await syncCheckoutSession(session);
  } catch (e) {
    console.error("No se pudo consultar Stripe", e);
  }
}
