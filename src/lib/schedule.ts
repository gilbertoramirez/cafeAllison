/** Horario de pedidos (hasta 2 turnos por día) y horarios para programar. Se usa en la tienda y en el servidor. */
import { localDate, localWeekday, TIMEZONE } from "./format";
import { WEEKDAYS } from "./types";

export type Shift = { open: string; close: string };

export type ScheduleRules = {
  /** el cliente puede elegir una hora y fuera de horario solo se programa */
  enabled: boolean;
  /** turnos de cada día: índice 0 = domingo … 6 = sábado. Sin turnos = cerrado */
  week: Shift[][];
  /** minutos mínimos para preparar un pedido */
  prepMinutes: number;
  /** cuántos días después de hoy se puede programar (0 = solo hoy) */
  daysAhead: number;
};

export type SlotDay = { ymd: string; label: string; slots: { iso: string; label: string }[] };

/** Horario de Café Allison: L–V 8–12 y 17–22, sábado 17–22, domingo cerrado. */
export const DEFAULT_WEEK: Shift[][] = [
  [],
  ...Array.from({ length: 5 }, () => [
    { open: "08:00", close: "12:00" },
    { open: "17:00", close: "22:00" },
  ]),
  [{ open: "17:00", close: "22:00" }],
];

const STEP = 15;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};
const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** Lee y limpia los turnos guardados (JSON); si no hay, usa el horario de fábrica. */
export function parseWeek(json: string | undefined): Shift[][] {
  try {
    const raw = JSON.parse(json ?? "") as Shift[][];
    if (!Array.isArray(raw) || raw.length !== 7) return DEFAULT_WEEK;
    return raw.map((day) =>
      (Array.isArray(day) ? day : [])
        .filter((s) => /^\d{2}:\d{2}$/.test(s?.open) && /^\d{2}:\d{2}$/.test(s?.close) && toMin(s.close) > toMin(s.open))
        .slice(0, 2)
        .sort((a, b) => toMin(a.open) - toMin(b.open)),
    );
  } catch {
    return DEFAULT_WEEK;
  }
}

/** Minutos que la hora local va adelante de UTC en ese momento (México: -360). */
function tzOffset(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Fecha local + minutos del día → instante real (ISO). */
function localToIso(ymd: string, minutes: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  return new Date(guess - tzOffset(new Date(guess)) * 60000).toISOString();
}

const minutesOfDay = (d: Date) => Math.round(((((d.getTime() + tzOffset(d) * 60000) / 60000) % 1440) + 1440) % 1440);
const shiftsOn = (r: ScheduleRules, d: Date) => (r.week[localWeekday(d)] ?? []).map((s) => [toMin(s.open), toMin(s.close)] as const);

/** ¿Está abierta ahora la cafetería según el horario? */
export function isOpenNow(r: ScheduleRules, now: Date = new Date()): boolean {
  const t = minutesOfDay(now);
  return shiftsOn(r, now).some(([o, c]) => t >= o && t < c);
}

/** Cuándo vuelve a abrir: "hoy a las 17:00", "mañana a las 8:00", "el lunes a las 8:00". */
export function nextOpening(r: ScheduleRules, now: Date = new Date()): string | null {
  const t = minutesOfDay(now);
  for (let i = 0; i <= 7; i++) {
    const day = new Date(now.getTime() + i * 86400_000);
    const start = shiftsOn(r, day).find(([o]) => i > 0 || o > t);
    if (start) {
      const when = i === 0 ? "hoy" : i === 1 ? "mañana" : `el ${["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][localWeekday(day)]}`;
      return `${when} a las ${hm(start[0])}`;
    }
  }
  return null;
}

/** Horarios disponibles para programar: desde ahora + preparación, cada 15 min, dentro de los turnos. */
export function slotDays(r: ScheduleRules, now: Date = new Date()): SlotDay[] {
  if (!r.enabled) return [];
  const earliest = now.getTime() + Math.max(0, r.prepMinutes) * 60000;
  const days: SlotDay[] = [];
  for (let i = 0; i <= Math.min(Math.max(0, r.daysAhead), 6); i++) {
    const day = new Date(now.getTime() + i * 86400_000);
    const ymd = localDate(day);
    const slots: SlotDay["slots"] = [];
    for (const [open, close] of shiftsOn(r, day)) {
      for (let t = Math.ceil(open / STEP) * STEP; t < close; t += STEP) {
        const iso = localToIso(ymd, t);
        if (Date.parse(iso) >= earliest) slots.push({ iso, label: hm(t) });
      }
    }
    if (slots.length) {
      days.push({ ymd, label: i === 0 ? "Hoy" : i === 1 ? "Mañana" : `${WEEKDAYS[localWeekday(day)]} ${ymd.slice(8)}`, slots });
    }
  }
  return days;
}

/** ¿Es una hora válida para programar ahora mismo? (el servidor la vuelve a revisar) */
export function isValidSlot(r: ScheduleRules, iso: string, now: Date = new Date()): boolean {
  return slotDays(r, now).some((d) => d.slots.some((s) => s.iso === iso));
}

/** "Hoy 8:15", "Mañana 9:00", "Vie 14/11 10:30" */
export function slotLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const ymd = localDate(d);
  const today = localDate(now);
  const tomorrow = localDate(new Date(now.getTime() + 86400_000));
  const day = ymd === today ? "Hoy" : ymd === tomorrow ? "Mañana" : `${WEEKDAYS[localWeekday(d)]} ${ymd.slice(8)}/${ymd.slice(5, 7)}`;
  return `${day} ${hm(minutesOfDay(d))}`;
}

/** Texto del horario: "Lun a Vie 8:00–12:00 y 17:00–22:00 · Sáb 17:00–22:00" (días seguidos iguales se agrupan). */
export function hoursText(r: ScheduleRules): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const text = (d: number) => r.week[d].map((s) => `${hm(toMin(s.open))}–${hm(toMin(s.close))}`).join(" y ");
  const parts: string[] = [];
  for (let i = 0; i < order.length; ) {
    const t = text(order[i]);
    let j = i;
    while (j + 1 < order.length && text(order[j + 1]) === t) j++;
    if (t) parts.push(`${WEEKDAYS[order[i]]}${j > i ? `${j - i > 1 ? " a " : " y "}${WEEKDAYS[order[j]]}` : ""} ${t}`);
    i = j + 1;
  }
  return parts.join(" · ") || "Cerrado";
}
