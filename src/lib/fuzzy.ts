/**
 * Búsqueda tolerante para el menú: ignora acentos y mayúsculas, acepta errores de dedo
 * ("capuchno" → Capuchino) y palabras incompletas ("frap" → Frappé).
 */

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Distancia de edición (con transposición) acotada: si pasa de `max` devuelve max + 1. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length];
}

/** ¿Las letras de `t` aparecen en orden dentro de `w`? (p. ej. "cpchno" en "capuchino") */
function subsequence(t: string, w: string) {
  let i = 0;
  for (const ch of w) if (ch === t[i]) i++;
  return i === t.length;
}

/** Qué tan bien coincide una palabra buscada con una palabra del producto (0 = nada). */
function wordScore(t: string, w: string): number {
  if (w === t) return 100;
  if (w.startsWith(t)) return 90 - Math.min(20, w.length - t.length);
  // A media palabra cuenta menos que un error de dedo: "late" → Latte antes que Chocolate
  if (t.length >= 3 && w.includes(t)) return 40;
  const allowed = t.length <= 3 ? 0 : t.length <= 6 ? 1 : 2;
  if (allowed > 0) {
    const d = Math.min(distance(t, w, allowed), distance(t, w.slice(0, t.length), allowed));
    if (d <= allowed) return 60 - d * 12;
  }
  if (t.length >= 4 && t[0] === w[0] && subsequence(t, w)) return 30;
  return 0;
}

export type SearchField = { text: string; weight: number };

/** Puntaje de un producto para la búsqueda (0 = no coincide). Todas las palabras buscadas deben coincidir. */
export function fuzzyScore(query: string, fields: SearchField[]): number {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  const words = fields.map((f) => ({ words: normalize(f.text).split(" ").filter(Boolean), weight: f.weight }));
  let total = 0;
  for (const t of tokens) {
    let best = 0;
    for (const f of words) for (const w of f.words) best = Math.max(best, wordScore(t, w) * f.weight);
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Filtra y ordena una lista por la búsqueda (sin búsqueda la deja igual). */
export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => SearchField[]): T[] {
  if (!normalize(query)) return items;
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, fields(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
