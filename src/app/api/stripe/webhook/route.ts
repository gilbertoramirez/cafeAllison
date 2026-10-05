import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { syncCheckoutSession } from "@/lib/payments";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "Webhook no configurado" }, { status: 400 });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    console.error("Firma de webhook inválida", e);
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.expired":
      await syncCheckoutSession(event.data.object);
      break;
  }
  return NextResponse.json({ received: true });
}
