import { all, get } from "./db";
import { addDays, localDate, startOfLocalDay } from "./format";

export type Range = { from: string; to: string }; // fechas locales YYYY-MM-DD, inclusivas

export function rangeFor(period: string | undefined): Range & { label: string } {
  const today = localDate();
  const [y, m] = today.split("-");
  switch (period) {
    case "hoy":
      return { from: today, to: today, label: "Hoy" };
    case "semana": {
      const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 domingo
      const monday = addDays(today, -((dow + 6) % 7));
      return { from: monday, to: today, label: "Esta semana" };
    }
    case "mes_pasado": {
      const firstThis = `${y}-${m}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { from: lastPrev.slice(0, 8) + "01", to: lastPrev, label: "Mes pasado" };
    }
    case "anio":
      return { from: `${y}-01-01`, to: today, label: "Este año" };
    case "mes":
    default:
      return { from: `${y}-${m}-01`, to: today, label: "Este mes" };
  }
}

function utcBounds(r: Range): [string, string] {
  return [startOfLocalDay(r.from), startOfLocalDay(addDays(r.to, 1))];
}

export async function salesSummary(r: Range) {
  const [a, b] = utcBounds(r);
  const row = await get<{ orders: number; sales: number; delivery: number }>(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(delivery_fee),0) AS delivery
     FROM orders WHERE payment_status = 'pagado' AND status != 'cancelado' AND created_at >= ? AND created_at < ?`,
    [a, b],
  );
  const cogs = await get<{ cogs: number }>(
    `SELECT COALESCE(SUM(oi.unit_cost * oi.qty),0) AS cogs FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'pagado' AND o.status != 'cancelado' AND o.created_at >= ? AND o.created_at < ?`,
    [a, b],
  );
  return {
    orders: Number(row?.orders ?? 0),
    sales: Number(row?.sales ?? 0),
    delivery: Number(row?.delivery ?? 0),
    cogs: Number(cogs?.cogs ?? 0),
  };
}

export async function salesByChannel(r: Range) {
  const [a, b] = utcBounds(r);
  return all<{ channel: string; payment_method: string; orders: number; total: number }>(
    `SELECT channel, payment_method, COUNT(*) AS orders, SUM(total) AS total FROM orders
     WHERE payment_status = 'pagado' AND status != 'cancelado' AND created_at >= ? AND created_at < ?
     GROUP BY channel, payment_method ORDER BY total DESC`,
    [a, b],
  );
}

export async function topProducts(r: Range, limit = 10) {
  const [a, b] = utcBounds(r);
  return all<{ name: string; qty: number; revenue: number; profit: number }>(
    `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.unit_price*oi.qty) AS revenue,
            SUM((oi.unit_price-oi.unit_cost)*oi.qty) AS profit
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'pagado' AND o.status != 'cancelado' AND o.created_at >= ? AND o.created_at < ?
     GROUP BY oi.name ORDER BY revenue DESC LIMIT ?`,
    [a, b, limit],
  );
}

export async function dailySales(r: Range) {
  const [a, b] = utcBounds(r);
  const rows = await all<{ created_at: string; total: number }>(
    `SELECT created_at, total FROM orders
     WHERE payment_status = 'pagado' AND status != 'cancelado' AND created_at >= ? AND created_at < ?`,
    [a, b],
  );
  const byDay = new Map<string, number>();
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) byDay.set(d, 0);
  for (const row of rows) {
    const d = localDate(new Date(row.created_at));
    byDay.set(d, (byDay.get(d) ?? 0) + Number(row.total));
  }
  return [...byDay.entries()].map(([day, total]) => ({ day, total }));
}

export async function expensesByCategory(r: Range) {
  return all<{ category: string; paid: number; pending: number }>(
    `SELECT category,
            COALESCE(SUM(CASE WHEN status='pagado' THEN amount END),0) AS paid,
            COALESCE(SUM(CASE WHEN status='pendiente' THEN amount END),0) AS pending
     FROM expenses WHERE date >= ? AND date <= ? GROUP BY category ORDER BY paid + pending DESC`,
    [r.from, r.to],
  );
}

/** Resumen financiero del periodo. */
export async function financeSummary(r: Range) {
  const s = await salesSummary(r);
  const exp = await expensesByCategory(r);
  const paidOperating = exp.filter((e) => e.category !== "resurtido").reduce((a, e) => a + Number(e.paid), 0);
  const paidRestock = exp.filter((e) => e.category === "resurtido").reduce((a, e) => a + Number(e.paid), 0);
  const grossProfit = s.sales - s.cogs;
  return {
    ...s,
    grossProfit,
    grossMargin: s.sales > 0 ? grossProfit / s.sales : 0,
    operatingExpenses: paidOperating,
    restock: paidRestock,
    netProfit: grossProfit - paidOperating,
    cashFlow: s.sales - paidOperating - paidRestock,
    expenses: exp,
  };
}

export async function pendingExpenses() {
  return all<{ id: number; date: string; category: string; description: string; amount: number }>(
    "SELECT id, date, category, description, amount FROM expenses WHERE status = 'pendiente' ORDER BY date",
  );
}
