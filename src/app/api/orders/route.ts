import { NextResponse } from "next/server";
import { createOrder, OrderError, setOrderStatus } from "@/lib/orders";
import { getDeliveryRules, getSettings, stripeEnabled } from "@/lib/settings";
import { normalizeCp, quoteDelivery } from "@/lib/delivery";
import { cardPricing, processorFee } from "@/lib/fees";
import { createCheckoutSession } from "@/lib/payments";
import { siteUrl } from "@/lib/url";
import { onlyDigits } from "@/lib/format";

type Body = {
  items?: { productId: number; qty: number; note?: string }[];
  customerName?: string;
  phone?: string;
  deliveryType?: string;
  address?: string;
  addressRef?: string;
  postalCode?: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
  paymentMethod?: string;
  cashGiven?: number | null;
};

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad("Solicitud no válida");
  }

  const settings = await getSettings();
  if (!settings.store_open) return bad("Por ahora no estamos recibiendo pedidos.");

  const name = String(body.customerName ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  if (!name) return bad("Escribe tu nombre.");
  if (onlyDigits(phone).length < 10) return bad("Escribe un teléfono válido de 10 dígitos.");

  const deliveryType = body.deliveryType === "domicilio" ? "domicilio" : "recoger";
  if (deliveryType === "domicilio" && !settings.delivery_enabled) return bad("La entrega a domicilio no está disponible.");
  const address = String(body.address ?? "").trim();
  if (deliveryType === "domicilio" && !address) return bad("Escribe tu dirección de entrega.");

  const rules = await getDeliveryRules();
  const postalCode = normalizeCp(String(body.postalCode ?? ""));
  if (deliveryType === "domicilio") {
    const check = quoteDelivery(rules, postalCode, 0);
    if (!check.ok) {
      return bad(
        check.reason === "cp_incompleto"
          ? "Escribe tu código postal de 5 dígitos."
          : `Por ahora no entregamos en el código postal ${postalCode}. Puedes pasar a recogerlo.`,
      );
    }
  }

  const pm = body.paymentMethod;
  const paymentMethod =
    pm === "stripe" && stripeEnabled() ? "stripe" : pm === "whatsapp" && settings.whatsapp_number ? "whatsapp" : "efectivo";

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  let order;
  try {
    order = await createOrder({
      channel: paymentMethod === "whatsapp" ? "whatsapp" : "web",
      items: Array.isArray(body.items) ? body.items.map((i) => ({ productId: Number(i.productId), qty: Number(i.qty), note: String(i.note ?? "") })) : [],
      customerName: name,
      phone,
      deliveryType,
      address,
      addressRef: String(body.addressRef ?? ""),
      lat: num(body.lat),
      lng: num(body.lng),
      notes: String(body.notes ?? ""),
      paymentMethod,
      paid: false,
      status: paymentMethod === "stripe" ? "pago_pendiente" : "nuevo",
      cashGiven: num(body.cashGiven) !== null ? Math.round(num(body.cashGiven)! * 100) : null,
      postalCode,
      // Solo a domicilio con tarjeta en línea: la comisión va incluida en los precios.
      // En efectivo o para recoger se respetan los precios normales.
      pricing:
        paymentMethod === "stripe" && deliveryType === "domicilio"
          ? (lines, delivery) => cardPricing(lines, delivery, settings.online_fee)
          : undefined,
      processingFee: paymentMethod === "stripe" ? (total) => processorFee(total, settings.online_fee) : undefined,
      deliveryFee: (subtotal) => {
        const q = quoteDelivery(rules, postalCode, subtotal);
        return q.ok ? q.fee : 0;
      },
      minSubtotal: deliveryType === "domicilio" ? settings.min_delivery_order : 0,
      enforceDays: true,
    });
  } catch (e) {
    if (e instanceof OrderError) return bad(e.message);
    throw e;
  }

  if (paymentMethod !== "stripe") {
    return NextResponse.json({ token: order.token });
  }

  // Pago en línea con Stripe Checkout: el pedido espera el pago y no aparece en el panel hasta pagarse
  try {
    const checkoutUrl = await createCheckoutSession(order, settings.business_name, await siteUrl());
    return NextResponse.json({ token: order.token, checkoutUrl });
  } catch (e) {
    console.error("Stripe error", e);
    await setOrderStatus(order.id, "cancelado", "No se pudo iniciar el pago en línea");
    return bad("No se pudo iniciar el pago en línea. Intenta con otra forma de pago.", 502);
  }
}
