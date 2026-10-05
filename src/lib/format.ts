export const TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE || "America/Mexico_City";

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Centavos -> "$1,234.50" */
export function money(cents: number | null | undefined): string {
  return mxn.format((cents ?? 0) / 100);
}

/** "123.45" -> 12345 */
export function toCents(value: FormDataEntryValue | string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TIMEZONE,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function time(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: TIMEZONE, timeStyle: "short" }).format(new Date(iso));
}

/** Fecha local "YYYY-MM-DD" de un instante. */
export function localDate(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return p; // en-CA ya da YYYY-MM-DD
}

/** Instante UTC (ISO) del inicio del día local "YYYY-MM-DD". */
export function startOfLocalDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Offset de la zona en ese instante
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asUtc - guess;
  return new Date(guess - offset).toISOString();
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Normaliza un teléfono mexicano a formato internacional para wa.me */
export function waNumber(phone: string): string {
  const d = onlyDigits(phone);
  if (d.length === 10) return "52" + d;
  return d;
}
