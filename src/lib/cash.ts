/** Corte de caja: apertura con fondo, entradas/salidas de efectivo y cierre con lo contado. */
import { all, get, run, transaction } from "./db";
import type { PaymentMethod } from "./types";

export type CashSession = {
  id: number;
  opened_at: string;
  opening_cash: number;
  open_note: string;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  close_note: string;
  summary: string | null;
};

export type CashMovement = { id: number; session_id: number; kind: "entrada" | "salida"; amount: number; reason: string; created_at: string };

export type CashSummary = {
  from: string;
  to: string;
  opening: number;
  /** ventas pagadas en el turno por forma de pago */
  byMethod: { method: PaymentMethod; count: number; total: number }[];
  sales: number;
  salesCount: number;
  cashSales: number;
  entradas: number;
  salidas: number;
  /** fondo + ventas en efectivo + entradas − salidas */
  expected: number;
  cancelled: { count: number; total: number };
  top: { name: string; qty: number }[];
};

export class CashError extends Error {}

export const currentSession = () =>
  get<CashSession>("SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1");

export const sessionById = (id: number) => get<CashSession>("SELECT * FROM cash_sessions WHERE id = ?", [id]);

export const sessionMovements = (id: number) =>
  all<CashMovement>("SELECT * FROM cash_movements WHERE session_id = ? ORDER BY id", [id]);

export const recentSessions = (limit = 30) =>
  all<CashSession>("SELECT * FROM cash_sessions ORDER BY id DESC LIMIT ?", [limit]);

/** Resumen del turno (en vivo si está abierto; si ya se cerró se usa lo guardado al cerrar). */
export async function sessionSummary(s: CashSession): Promise<CashSummary> {
  if (s.closed_at && s.summary) return JSON.parse(s.summary) as CashSummary;
  const from = s.opened_at;
  const to = s.closed_at ?? new Date().toISOString();
  const [byMethod, moves, cancelled, top] = await Promise.all([
    all<{ method: PaymentMethod; count: number; total: number }>(
      `SELECT payment_method AS method, COUNT(*) AS count, SUM(total) AS total FROM orders
       WHERE payment_status = 'pagado' AND status <> 'cancelado' AND paid_at >= ? AND paid_at < ?
       GROUP BY payment_method ORDER BY total DESC`,
      [from, to],
    ),
    all<{ kind: string; total: number }>("SELECT kind, SUM(amount) AS total FROM cash_movements WHERE session_id = ? GROUP BY kind", [s.id]),
    get<{ count: number; total: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM orders
       WHERE status = 'cancelado' AND payment_status = 'pagado' AND cancelled_at >= ? AND cancelled_at < ?`,
      [from, to],
    ),
    all<{ name: string; qty: number }>(
      `SELECT oi.name, SUM(oi.qty) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.payment_status = 'pagado' AND o.status <> 'cancelado' AND o.paid_at >= ? AND o.paid_at < ?
       GROUP BY oi.name ORDER BY qty DESC LIMIT 5`,
      [from, to],
    ),
  ]);
  const sumKind = (k: string) => Number(moves.find((m) => m.kind === k)?.total ?? 0);
  const methods = byMethod.map((m) => ({ method: m.method, count: Number(m.count), total: Number(m.total) }));
  const cashSales = methods.find((m) => m.method === "efectivo")?.total ?? 0;
  const entradas = sumKind("entrada");
  const salidas = sumKind("salida");
  return {
    from,
    to,
    opening: s.opening_cash,
    byMethod: methods,
    sales: methods.reduce((a, m) => a + m.total, 0),
    salesCount: methods.reduce((a, m) => a + m.count, 0),
    cashSales,
    entradas,
    salidas,
    expected: s.opening_cash + cashSales + entradas - salidas,
    cancelled: { count: Number(cancelled?.count ?? 0), total: Number(cancelled?.total ?? 0) },
    top: top.map((t) => ({ name: t.name, qty: Number(t.qty) })),
  };
}

export async function openSession(openingCash: number, note: string) {
  if (await currentSession()) throw new CashError("Ya hay una caja abierta. Ciérrala antes de abrir otra.");
  await run("INSERT INTO cash_sessions (opened_at, opening_cash, open_note) VALUES (?, ?, ?)", [
    new Date().toISOString(),
    Math.max(0, openingCash),
    note.slice(0, 200),
  ]);
}

export async function addMovement(kind: "entrada" | "salida", amount: number, reason: string) {
  const s = await currentSession();
  if (!s) throw new CashError("Primero abre la caja.");
  if (amount <= 0) throw new CashError("Escribe un monto mayor a $0.");
  if (!reason.trim()) throw new CashError("Escribe el motivo (p. ej. pago a proveedor, cambio, retiro).");
  await run("INSERT INTO cash_movements (session_id, kind, amount, reason) VALUES (?, ?, ?, ?)", [s.id, kind, amount, reason.slice(0, 200)]);
}

/** Cierra la caja guardando el resumen del turno tal como quedó. Devuelve el id del corte. */
export async function closeSession(counted: number, note: string): Promise<number> {
  const s = await currentSession();
  if (!s) throw new CashError("No hay una caja abierta.");
  const closedAt = new Date().toISOString();
  const summary = await sessionSummary({ ...s, closed_at: closedAt });
  await transaction(async (q) => {
    await q(
      `UPDATE cash_sessions SET closed_at = ?, counted_cash = ?, expected_cash = ?, close_note = ?, summary = ?
       WHERE id = ? AND closed_at IS NULL`,
      [closedAt, Math.max(0, counted), summary.expected, note.slice(0, 300), JSON.stringify(summary), s.id],
    );
  });
  return s.id;
}
