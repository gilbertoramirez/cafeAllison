import type Stripe from "stripe";
import { get } from "./db";
import { markOrderPaid, setOrderStatus } from "./orders";
import { getStripe } from "./stripe";
import type { Order } from "./types";

/** Aplica el resultado de una sesión de Stripe Checkout al pedido. Idempotente. */
export async function syncCheckoutSession(session: Stripe.Checkout.Session) {
  const order = await get<Order>("SELECT * FROM orders WHERE stripe_session_id = ?", [session.id]);
  if (!order) return;
  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    await markOrderPaid(order.id);
  } else if (session.status === "expired" && order.payment_status !== "pagado") {
    await setOrderStatus(order.id, "cancelado");
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
