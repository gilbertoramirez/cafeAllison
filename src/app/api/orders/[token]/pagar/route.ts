import { NextResponse } from "next/server";
import { getOrderByToken } from "@/lib/orders";
import { createCheckoutSession, expireCheckoutSession, refreshStripeOrder } from "@/lib/payments";
import { getSettings, stripeEnabled } from "@/lib/settings";
import { siteUrl } from "@/lib/url";

/** Reintentar el pago en línea de un pedido que quedó esperando pago. */
export async function POST(_req: Request, ctx: RouteContext<"/api/orders/[token]/pagar">) {
  const { token } = await ctx.params;
  let order = await getOrderByToken(token);
  if (!order || !stripeEnabled()) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  await refreshStripeOrder(order); // por si sí se pagó
  order = (await getOrderByToken(token))!;
  if (order.status !== "pago_pendiente" || order.payment_status === "pagado") {
    return NextResponse.json({ error: "Este pedido ya no está esperando pago.", paid: order.payment_status === "pagado" }, { status: 409 });
  }
  await expireCheckoutSession(order.stripe_session_id);
  try {
    const checkoutUrl = await createCheckoutSession(order, (await getSettings()).business_name, await siteUrl());
    return NextResponse.json({ checkoutUrl });
  } catch (e) {
    console.error("Stripe error", e);
    return NextResponse.json({ error: "No se pudo abrir el pago. Intenta de nuevo." }, { status: 502 });
  }
}
