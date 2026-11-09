/** Reparto: mejor ruta para varios pedidos a domicilio y cambios de estado del repartidor. */
import { all, get, run } from "./db";
import { cafeLocation, geocode, mapsEnabled, optimizeRoute } from "./maps";
import { orderCode, setOrderStatus } from "./orders";
import type { Order, OrderStatus } from "./types";


export type RouteStop = {
  orderId: number;
  code: string;
  name: string;
  phone: string;
  address: string;
  addressRef: string;
  postalCode: string;
  notes: string;
  total: number;
  /** cuánto cobrar al entregar (0 = ya pagado) */
  collect: number;
  cashGiven: number | null;
  status: OrderStatus;
  lat: number;
  lng: number;
  km: number;
  minutes: number | null;
};

export type RouteResult =
  | {
      ok: true;
      optimized: boolean;
      returnToCafe: boolean;
      totalKm: number;
      totalMinutes: number | null;
      back: { km: number; minutes: number | null } | null;
      stops: RouteStop[];
      missing: { code: string; name: string; address: string }[];
      links: string[];
    }
  | { ok: false; message: string };

function mapsDirLinks(points: { lat: number; lng: number }[]): string[] {
  const p = (x: { lat: number; lng: number }) => `${x.lat},${x.lng}`;
  const links: string[] = [];
  // Google Maps abre hasta 9 paradas intermedias por link: si hay más, se parte en varios tramos
  for (let i = 0; i < points.length - 1; ) {
    const end = Math.min(i + 10, points.length - 1);
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", p(points[i]));
    url.searchParams.set("destination", p(points[end]));
    const mid = points.slice(i + 1, end);
    if (mid.length) url.searchParams.set("waypoints", mid.map(p).join("|"));
    url.searchParams.set("travelmode", "driving");
    links.push(url.toString());
    i = end;
  }
  return links;
}

export async function planRoute(orderIds: number[], returnToCafe: boolean): Promise<RouteResult> {
  const ids = [...new Set(orderIds.map(Number).filter(Number.isInteger))].slice(0, 25);
  if (!ids.length) return { ok: false, message: "Selecciona al menos un pedido." };
  const cafe = await cafeLocation();
  if (!cafe) return { ok: false, message: "Configura la ubicación de la cafetería en Ajustes → Envío a domicilio." };
  const orders = await all<Order>(
    `SELECT * FROM orders WHERE id IN (${ids.map(() => "?").join(",")}) AND delivery_type = 'domicilio' AND status NOT IN ('cancelado', 'entregado', 'pago_pendiente')`,
    ids,
  );
  const located: { o: Order; at: { lat: number; lng: number } }[] = [];
  const missing: { code: string; name: string; address: string }[] = [];
  for (const o of orders) {
    let at = o.dest_lat != null && o.dest_lng != null ? { lat: o.dest_lat, lng: o.dest_lng } : o.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : null;
    if (!at && mapsEnabled()) {
      const g = await geocode([o.address, o.postal_code && `C.P. ${o.postal_code}`].filter(Boolean).join(", "), cafe).catch(() => null);
      if (g) {
        at = { lat: g.lat, lng: g.lng };
        await run("UPDATE orders SET dest_lat = ?, dest_lng = ? WHERE id = ?", [g.lat, g.lng, o.id]);
      }
    }
    if (at) located.push({ o, at });
    else missing.push({ code: orderCode(o.id), name: o.customer_name, address: o.address });
  }
  if (!located.length) {
    return { ok: false, message: "No pudimos ubicar en el mapa ninguno de los pedidos seleccionados." };
  }
  const plan = await optimizeRoute(cafe, located.map((l) => l.at), returnToCafe);
  const stops: RouteStop[] = plan.order.map((i, k) => {
    const { o, at } = located[i];
    const unpaid = o.payment_status !== "pagado";
    return {
      orderId: o.id,
      code: orderCode(o.id),
      name: o.customer_name,
      phone: o.phone,
      address: o.address,
      addressRef: o.address_ref,
      postalCode: o.postal_code,
      notes: o.notes,
      total: o.total,
      collect: unpaid ? o.total : 0,
      cashGiven: unpaid && o.payment_method === "efectivo" ? o.cash_given : null,
      status: o.status,
      lat: at.lat,
      lng: at.lng,
      km: plan.legs[k]?.km ?? 0,
      minutes: plan.legs[k]?.minutes ?? null,
    };
  });
  const back = returnToCafe ? (plan.legs[stops.length] ?? null) : null;
  return {
    ok: true,
    optimized: plan.optimized,
    returnToCafe,
    totalKm: plan.totalKm,
    totalMinutes: plan.totalMinutes,
    back,
    stops,
    missing,
    links: mapsDirLinks([cafe, ...stops, ...(returnToCafe ? [cafe] : [])]),
  };
}


const validIds = (ids: number[]) => [...new Set(ids.map(Number).filter(Number.isInteger))].slice(0, 25);

/** "En camino" para varios pedidos a domicilio (y quién los lleva, si es un repartidor). */
export async function markOnTheWay(orderIds: number[], driverId: number | null) {
  for (const id of validIds(orderIds)) {
    const o = await get<{ status: OrderStatus; delivery_type: string }>("SELECT status, delivery_type FROM orders WHERE id = ?", [id]);
    if (!o || o.delivery_type !== "domicilio") continue;
    if (o.status === "nuevo" || o.status === "preparando") await setOrderStatus(id, "en_camino");
    if (driverId && o.status !== "entregado" && o.status !== "cancelado") {
      await run("UPDATE orders SET driver_id = ? WHERE id = ?", [driverId, id]);
    }
  }
}

/** Entregado (solo pedidos a domicilio activos). En efectivo queda pagado al entregar. */
export async function markDelivered(orderId: number, driverId: number | null) {
  const o = await get<{ status: OrderStatus; delivery_type: string }>("SELECT status, delivery_type FROM orders WHERE id = ?", [
    Number(orderId),
  ]);
  if (!o || o.delivery_type !== "domicilio" || !["nuevo", "preparando", "en_camino"].includes(o.status)) return;
  if (driverId) await run("UPDATE orders SET driver_id = ? WHERE id = ?", [driverId, orderId]);
  await setOrderStatus(orderId, "entregado");
}
