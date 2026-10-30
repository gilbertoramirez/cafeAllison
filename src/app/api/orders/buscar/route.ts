import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { onlyDigits } from "@/lib/format";

/** Encontrar un pedido hecho desde otro dispositivo: número de pedido + teléfono. */
export async function POST(req: Request) {
  let body: { code?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  }
  const id = Number(onlyDigits(String(body.code ?? "")));
  const phone = onlyDigits(String(body.phone ?? "")).slice(-10);
  if (!id || phone.length < 10) {
    return NextResponse.json({ error: "Escribe el número de pedido y tu teléfono de 10 dígitos." }, { status: 400 });
  }
  const order = await get<{ token: string; phone: string }>(
    "SELECT token, phone FROM orders WHERE id = ? AND channel <> 'mostrador'",
    [id],
  );
  // Mismo mensaje si no existe o no coincide el teléfono (no revela pedidos ajenos)
  if (!order || onlyDigits(order.phone).slice(-10) !== phone) {
    return NextResponse.json({ error: "No encontramos un pedido con esos datos." }, { status: 404 });
  }
  return NextResponse.json({ token: order.token });
}
