/** Saca coordenadas de lo que pegue el usuario: "lat, lng" o un link de Google Maps. */

export type Coords = { lat: number; lng: number };

const valid = (lat: number, lng: number): Coords | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
    ? { lat, lng }
    : null;

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

export function parseCoords(input: string): Coords | null {
  let text = input.trim();
  if (!text) return null;
  try {
    text = decodeURIComponent(text);
  } catch {}
  // 1) Solo números: "20.6510064, -103.3259342"
  let m = text.match(new RegExp(`^${NUM}\\s*,\\s*${NUM}$`));
  if (m) return valid(Number(m[1]), Number(m[2]));
  // 2) Pin exacto del lugar en links de Google Maps: !3d<lat>!4d<lng> (se usa el último)
  const pins = [...text.matchAll(new RegExp(`!3d${NUM}!4d${NUM}`, "g"))];
  if (pins.length) {
    const p = pins[pins.length - 1];
    return valid(Number(p[1]), Number(p[2]));
  }
  // 3) Parámetros con coordenadas: ?q=lat,lng · query= · ll= · center= · destination=
  m = text.match(new RegExp(`[?&](?:q|query|ll|center|destination|daddr)=(?:loc:)?${NUM}\\s*,\\s*${NUM}`));
  if (m) return valid(Number(m[1]), Number(m[2]));
  // 4) "/search/lat,lng" o "/place/lat,lng"
  m = text.match(new RegExp(`/(?:search|place|dir)/(?:[^/]*/)?${NUM}\\s*,\\s*\\+?${NUM}`));
  if (m) return valid(Number(m[1]), Number(m[2]));
  // 5) Centro del mapa: @lat,lng,17z (menos exacto que el pin)
  m = text.match(new RegExp(`@${NUM},${NUM}`));
  if (m) return valid(Number(m[1]), Number(m[2]));
  return null;
}

/** Links cortos de Google Maps que hay que abrir para ver las coordenadas. */
export function isShortMapsLink(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return u.hostname === "maps.app.goo.gl" || (u.hostname === "goo.gl" && u.pathname.startsWith("/maps"));
  } catch {
    return false;
  }
}

const GOOGLE_HOSTS = /^(?:maps\.app\.goo\.gl|goo\.gl|(?:www\.|maps\.)?google\.com(?:\.mx)?|consent\.google\.com)$/;

/**
 * Abre un link corto de Google Maps siguiendo sus redirecciones (solo dominios de Google)
 * hasta encontrar uno con coordenadas.
 */
export async function resolveShortMapsLink(input: string, fetcher: typeof fetch = fetch): Promise<Coords | null> {
  let url = input.trim();
  for (let i = 0; i < 6; i++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || !GOOGLE_HOSTS.test(u.hostname)) return null;
    const found = parseCoords(url);
    if (found) return found;
    // La página de consentimiento lleva el link real en ?continue=
    const cont = u.searchParams.get("continue");
    if (cont) {
      url = cont;
      continue;
    }
    const res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(6000) });
    const next = res.headers.get("location");
    if (!next) {
      // Sin redirección: a veces el link real viene en el HTML
      const html = res.status === 200 ? (await res.text()).slice(0, 200_000) : "";
      const inPage = html.match(/https:\/\/www\.google\.com[^"'\s<>]*!3d-?\d[^"'\s<>]*/);
      return inPage ? parseCoords(inPage[0].replace(/\\u0026/g, "&")) : null;
    }
    url = new URL(next, url).toString();
  }
  return null;
}
