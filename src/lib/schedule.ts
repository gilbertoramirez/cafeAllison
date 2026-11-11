/** Horario de pedidos y horarios disponibles para programar (se usa en la tienda y en el servidor). */
import { localDate, localWeekday, TIMEZONE } from "./format";
import { WEEKDAYS } from "./types";

export type ScheduleRules = {
  /** el cliente puede elegir una hora */
  enabled: boolean;
  /** días que abre: "1,2,3,4,5,6" (0 = domingo). Vacío = todos */
  days: string;
  /** "08:00" */
  open: string;
  /** "20:00" */
  close: string;
  /** minutos mínimos para preparar un pedido */
  prepMinutes: number;
  /** cuántos días después de hoy se puede programar (0 = solo hoy) */
  daysAhead: number;
};

export type SlotDay = { ymd: string; label: string; slots: { iso: string; label: string }[] };

const STEP = 15;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

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

const openOn = (r: ScheduleRules, d: Date) => !r.days.trim() || r.days.split(",").map(Number).includes(localWeekday(d));

const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** ¿Está abierta ahora la cafetería según el horario? */
export function isOpenNow(r: ScheduleRules, now: Date = new Date()): boolean {
  const open = toMin(r.open);
  const close = toMin(r.close);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return true;
  if (!openOn(r, now)) return false;
  const local = (now.getTime() + tzOffset(now) * 60000) / 60000;
  const minutesToday = ((local % 1440) + 1440) % 1440;
  return minutesToday >= open && minutesToday < close;
}

/** Horarios disponibles para programar: desde ahora + preparación, cada 15 min, dentro del horario. */
export function slotDays(r: ScheduleRules, now: Date = new Date()): SlotDay[] {
  if (!r.enabled) return [];
  const open = toMin(r.open);
  const close = toMin(r.close);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return [];
  const earliest = now.getTime() + Math.max(0, r.prepMinutes) * 60000;
  const days: SlotDay[] = [];
  for (let i = 0; i <= Math.min(Math.max(0, r.daysAhead), 6); i++) {
    const day = new Date(now.getTime() + i * 86400_000);
    if (!openOn(r, day)) continue;
    const ymd = localDate(day);
    const slots: SlotDay["slots"] = [];
    for (let t = Math.ceil(open / STEP) * STEP; t < close; t += STEP) {
      const iso = localToIso(ymd, t);
      if (Date.parse(iso) >= earliest) slots.push({ iso, label: hm(t) });
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

/** "Hoy 8:15", "Mañana 9:00", "Vie 14 10:30" */
export function slotLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const ymd = localDate(d);
  const today = localDate(now);
  const tomorrow = localDate(new Date(now.getTime() + 86400_000));
  const mins = Math.round(((((d.getTime() + tzOffset(d) * 60000) / 60000) % 1440) + 1440) % 1440);
  const local = hm(mins);
  const day = ymd === today ? "Hoy" : ymd === tomorrow ? "Mañana" : `${WEEKDAYS[localWeekday(d)]} ${ymd.slice(8)}/${ymd.slice(5, 7)}`;
  return `${day} ${local}`;
}
