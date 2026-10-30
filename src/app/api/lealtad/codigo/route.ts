import { NextResponse } from "next/server";
import { loyaltyStatus, sendRedeemCode } from "@/lib/loyalty";

/** Envía el código para canjear la bebida gratis en línea. */
export async function POST(req: Request) {
  let phone = "";
  try {
    phone = String((await req.json()).phone ?? "");
  } catch {}
  const status = await loyaltyStatus(phone);
  if (!status?.rewards.length) return NextResponse.json({ error: "No tienes una bebida gratis disponible." }, { status: 400 });
  try {
    const { devCode } = await sendRedeemCode(phone);
    return NextResponse.json({ ok: true, devCode });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo enviar" }, { status: 400 });
  }
}
