import { NextResponse } from "next/server";
import { normalizeCp } from "@/lib/delivery";
import { deliveryDistance } from "@/lib/maps";
import { getDeliveryRules } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Límite sencillo por dispositivo para no gastar consultas de Google Maps de más
const hits = new Map<string, number[]>();
function tooMany(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 40;
}

const coord = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max ? v : null);

/** Distancia desde la cafetería hasta la dirección (o ubicación GPS) del cliente. El costo lo calcula la tienda con la tarifa. */
export async function POST(req: Request) {
  const rules = await getDeliveryRules();
  if (!rules.maps) return NextResponse.json({ ok: true, km: null });
  let body: { address?: string; postalCode?: string; lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Solicitud no válida" }, { status: 400 });
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (tooMany(ip)) {
    return NextResponse.json({ ok: false, message: "Demasiadas consultas. Espera unos minutos e intenta de nuevo." }, { status: 429 });
  }
  const lat = coord(body.lat, 90);
  const lng = coord(body.lng, 180);
  const r = await deliveryDistance({
    address: String(body.address ?? "").slice(0, 200),
    postalCode: normalizeCp(String(body.postalCode ?? "")),
    location: lat !== null && lng !== null ? { lat, lng } : null,
  });
  if (!r.ok) return NextResponse.json({ ok: false, message: r.message });
  if (rules.maxKm > 0 && r.km > rules.maxKm) {
    return NextResponse.json({
      ok: false,
      km: r.km,
      formatted: r.formatted,
      message: `Tu dirección está a ${r.km} km y entregamos hasta ${rules.maxKm} km. Puedes elegir “Paso a recoger”.`,
    });
  }
  return NextResponse.json({ ok: true, km: r.km, minutes: r.minutes, formatted: r.formatted, approx: r.approx });
}
