/**
 * Google Maps (solo servidor): ubica direcciones (Geocoding API) y mide la distancia por calle (Routes API).
 * Las respuestas se guardan en la base de datos para no pagar dos veces por la misma consulta.
 */
import { get, run } from "./db";
import { getSettings, setSetting } from "./settings";

export type LatLng = { lat: number; lng: number };
export type Place = LatLng & { formatted: string; approx: boolean };

const GEOCODE_URL = () => process.env.GOOGLE_GEOCODE_URL || "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_URL = () => process.env.GOOGLE_ROUTES_URL || "https://routes.googleapis.com/directions/v2:computeRoutes";
const CACHE_DAYS = 30;

export function mapsEnabled() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

export class MapsError extends Error {}

async function cached<T>(key: string, compute: () => Promise<T | null>): Promise<T | null> {
  const row = await get<{ value: string; created_at: string }>("SELECT value, created_at FROM maps_cache WHERE key = ?", [key]);
  if (row && Date.now() - Date.parse(row.created_at) < CACHE_DAYS * 86400_000) return JSON.parse(row.value) as T;
  const value = await compute();
  if (value !== null) {
    await run(
      `INSERT INTO maps_cache (key, value, created_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
      [key, JSON.stringify(value), new Date().toISOString()],
    );
  }
  return value;
}

/** Busca una dirección en México (cerca de la cafetería si ya se conoce su ubicación). null = no se encontró. */
export async function geocode(address: string, near?: LatLng | null): Promise<Place | null> {
  const q = address.replace(/\s+/g, " ").trim();
  if (q.length < 4) return null;
  return cached(`geo:${q.toLowerCase()}`, async () => {
    const url = new URL(GEOCODE_URL());
    url.searchParams.set("address", q);
    url.searchParams.set("components", "country:MX");
    url.searchParams.set("language", "es");
    url.searchParams.set("region", "mx");
    if (near) url.searchParams.set("bounds", `${near.lat - 0.3},${near.lng - 0.3}|${near.lat + 0.3},${near.lng + 0.3}`);
    url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY ?? "");
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      results?: {
        formatted_address: string;
        partial_match?: boolean;
        geometry: { location: LatLng; location_type: string };
      }[];
    };
    if (data.status === "ZERO_RESULTS") return null;
    if (data.status !== "OK" || !data.results?.length) {
      throw new MapsError(`Google Maps (Geocoding): ${data.status} ${data.error_message ?? ""}`.trim());
    }
    const r = data.results[0];
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formatted: r.formatted_address,
      // Solo la colonia o la ciudad, no la casa: hay que confirmar con el cliente
      approx: Boolean(r.partial_match) || !["ROOFTOP", "RANGE_INTERPOLATED"].includes(r.geometry.location_type),
    };
  });
}

/** Distancia en línea recta (km), para cuando no se puede calcular la ruta. */
function straightKm(a: LatLng, b: LatLng) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Kilómetros por calle en auto/moto entre dos puntos. */
export async function routeKm(from: LatLng, to: LatLng): Promise<{ km: number; minutes: number | null }> {
  const key = `route:${round4(from.lat)},${round4(from.lng)}>${round4(to.lat)},${round4(to.lng)}`;
  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const r = await cached(key, async () => {
      const res = await fetch(ROUTES_URL(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY ?? "",
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({ origin: point(from), destination: point(to), travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE" }),
        signal: AbortSignal.timeout(6000),
      });
      const data = (await res.json()) as { routes?: { distanceMeters?: number; duration?: string }[]; error?: { message?: string } };
      if (!res.ok) throw new MapsError(`Google Maps (Routes): ${res.status} ${data.error?.message ?? ""}`.trim());
      const route = data.routes?.[0];
      if (!route?.distanceMeters) return null;
      return { km: route.distanceMeters / 1000, minutes: route.duration ? Math.round(parseInt(route.duration) / 60) : null };
    });
    if (r) return r;
  } catch (e) {
    console.error("maps", e);
  }
  // Sin ruta disponible: línea recta × 1.4 (aprox. de calles en ciudad)
  return { km: straightKm(from, to) * 1.4, minutes: null };
}

/** Ubicación de la cafetería: la guardada en Ajustes o, si no hay, la de su dirección. */
export async function cafeLocation(): Promise<LatLng | null> {
  const s = await getSettings();
  if (s.cafe_location) return s.cafe_location;
  if (!s.address) return null;
  const place = await geocode(s.address);
  if (!place) return null;
  await setSetting("cafe_lat", String(place.lat));
  await setSetting("cafe_lng", String(place.lng));
  return place;
}

export type DistanceResult =
  | { ok: true; km: number; minutes: number | null; formatted: string; approx: boolean; destination: LatLng }
  | { ok: false; reason: "no_encontrada" | "sin_cafeteria" | "error"; message: string };

/** Distancia desde la cafetería hasta el cliente (por su ubicación GPS o por su dirección). */
export async function deliveryDistance(input: {
  address: string;
  postalCode: string;
  location?: LatLng | null;
}): Promise<DistanceResult> {
  try {
    const cafe = await cafeLocation();
    if (!cafe) {
      return {
        ok: false,
        reason: "sin_cafeteria",
        message: "La cafetería aún no tiene su ubicación configurada. Elige “Paso a recoger” o escríbenos.",
      };
    }
    let dest: Place | null;
    if (input.location) {
      dest = { ...input.location, formatted: "Tu ubicación compartida", approx: false };
    } else {
      dest = await geocode([input.address, input.postalCode && `C.P. ${input.postalCode}`].filter(Boolean).join(", "), cafe);
      if (!dest) {
        return {
          ok: false,
          reason: "no_encontrada",
          message: "No encontramos tu dirección en el mapa. Revisa calle, número, colonia y código postal, o toca “Compartir mi ubicación”.",
        };
      }
    }
    const { km, minutes } = await routeKm(cafe, dest);
    return { ok: true, km: Math.round(km * 10) / 10, minutes, formatted: dest.formatted, approx: dest.approx, destination: dest };
  } catch (e) {
    console.error("maps", e);
    return {
      ok: false,
      reason: "error",
      message: "No pudimos calcular el envío en este momento. Intenta de nuevo o toca “Compartir mi ubicación”.",
    };
  }
}
