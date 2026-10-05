import Link from "next/link";
import { all } from "@/lib/db";
import { financeSummary, pendingExpenses, rangeFor, salesSummary } from "@/lib/finance";
import { dateTime, localDate, money } from "@/lib/format";
import { orderCode } from "@/lib/orders";
import type { Order, Product, Supply } from "@/lib/types";
import { EXPENSE_CATEGORIES, ORDER_STATUS_LABEL, productLabel } from "@/lib/types";
import { PageTitle, Stat } from "@/components/admin/ui";

export default async function Dashboard() {
  const today = rangeFor("hoy");
  const month = rangeFor("mes");
  const [todaySales, monthFin, pending, lowProducts, lowSupplies, activeOrders] = await Promise.all([
    salesSummary(today),
    financeSummary(month),
    pendingExpenses(),
    all<Product>("SELECT * FROM products WHERE active = 1 AND track_stock = 1 AND stock <= min_stock ORDER BY stock"),
    all<Supply>("SELECT * FROM supplies WHERE qty <= min_qty ORDER BY name"),
    all<Order>("SELECT * FROM orders WHERE status NOT IN ('entregado','cancelado') ORDER BY created_at"),
  ]);

  const todayYmd = localDate();
  const overdue = pending.filter((p) => p.date < todayYmd);
  const pendingTotal = pending.reduce((a, p) => a + Number(p.amount), 0);
  const dueThisMonth = pending.filter((p) => p.date <= monthEnd(todayYmd));
  const dueThisMonthTotal = dueThisMonth.reduce((a, p) => a + Number(p.amount), 0);

  // ¿Cuánto falta vender este mes para cubrir lo que hay que pagar?
  const margin = monthFin.grossMargin > 0 ? monthFin.grossMargin : 0.6;
  const salesNeeded = Math.max(0, Math.round((dueThisMonthTotal - Math.max(monthFin.cashFlow, 0)) / margin));
  const daysLeft = daysUntil(monthEnd(todayYmd), todayYmd) + 1;

  return (
    <div className="space-y-6">
      <PageTitle actions={<Link href="/admin/pos" className="btn-primary">🧾 Nueva venta</Link>}>Resumen</PageTitle>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Stat label="Ventas de hoy" value={money(todaySales.sales)} hint={`${todaySales.orders} ventas`} />
        <Stat label="Ventas del mes" value={money(monthFin.sales)} hint={`${monthFin.orders} ventas`} />
        <Stat
          label="Utilidad neta del mes"
          value={money(monthFin.netProfit)}
          tone={monthFin.netProfit >= 0 ? "good" : "bad"}
          hint="Ventas − costo de lo vendido − gastos"
        />
        <Stat
          label="Por pagar"
          value={money(pendingTotal)}
          tone={overdue.length ? "bad" : pendingTotal ? "warn" : "default"}
          hint={overdue.length ? `${overdue.length} vencido(s)` : `${pending.length} pendiente(s)`}
        />
      </div>

      {dueThisMonthTotal > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="font-medium text-amber-900">
            Este mes tienes {money(dueThisMonthTotal)} por pagar.
            {salesNeeded > 0 ? (
              <>
                {" "}
                Con tu margen actual ({Math.round(margin * 100)}%) necesitas vender aprox.{" "}
                <strong>{money(salesNeeded)}</strong> más ({money(Math.round(salesNeeded / daysLeft))} diarios en los{" "}
                {daysLeft} días que quedan).
              </>
            ) : (
              <> Tu flujo de caja del mes ya lo cubre. 🎉</>
            )}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Pedidos activos ({activeOrders.length})</h2>
            <Link href="/admin/pedidos" className="text-sm text-cafe-700 underline">
              Ver todos
            </Link>
          </div>
          {activeOrders.length === 0 ? (
            <p className="text-sm text-cafe-600">No hay pedidos pendientes.</p>
          ) : (
            <ul className="divide-y divide-cafe-50 text-sm">
              {activeOrders.slice(0, 8).map((o) => (
                <li key={o.id} className="flex justify-between gap-2 py-2">
                  <span>
                    <strong>{orderCode(o.id)}</strong> {o.customer_name} ·{" "}
                    {o.delivery_type === "domicilio" ? "🛵" : "🏪"} {ORDER_STATUS_LABEL[o.status]}
                  </span>
                  <span className="text-cafe-600">{dateTime(o.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Próximos pagos</h2>
            <Link href="/admin/gastos" className="text-sm text-cafe-700 underline">
              Gastos
            </Link>
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-cafe-600">Nada pendiente. Registra tu renta como gasto recurrente para verla aquí.</p>
          ) : (
            <ul className="divide-y divide-cafe-50 text-sm">
              {pending.slice(0, 8).map((p) => (
                <li key={p.id} className="flex justify-between gap-2 py-2">
                  <span className={p.date < todayYmd ? "text-red-700" : ""}>
                    {p.date} · {EXPENSE_CATEGORIES[p.category] ?? p.category}
                    {p.description ? ` — ${p.description}` : ""}
                  </span>
                  <span className="font-medium tabular-nums">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Inventario bajo</h2>
            <Link href="/admin/inventario" className="text-sm text-cafe-700 underline">
              Resurtir
            </Link>
          </div>
          {lowProducts.length + lowSupplies.length === 0 ? (
            <p className="text-sm text-cafe-600">Todo en orden.</p>
          ) : (
            <div className="flex flex-wrap gap-2 text-sm">
              {lowProducts.map((p) => (
                <span key={`p${p.id}`} className="badge bg-red-50 text-red-700">
                  {productLabel(p)}: {p.stock}
                </span>
              ))}
              {lowSupplies.map((s) => (
                <span key={`s${s.id}`} className="badge bg-amber-50 text-amber-800">
                  {s.name}: {s.qty} {s.unit}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function monthEnd(ymd: string) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function daysUntil(a: string, b: string) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}
