import { NextResponse } from "next/server";
import { loyaltyStatus } from "@/lib/loyalty";
import { smsEnabled } from "@/lib/sms";

export const dynamic = "force-dynamic";

/** Tarjeta de sellos de un teléfono. */
export async function GET(req: Request) {
  const phone = new URL(req.url).searchParams.get("phone") ?? "";
  const status = await loyaltyStatus(phone);
  return NextResponse.json({
    status,
    // canje en línea disponible (con Twilio; en desarrollo el código se muestra en pantalla)
    onlineRedeem: smsEnabled() || process.env.NODE_ENV !== "production",
  });
}
