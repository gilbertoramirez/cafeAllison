import { Bars, PageTitle, PeriodTabs, Stat } from "@/components/admin/ui";
import { dailySales, financeSummary, rangeFor, salesByChannel, topProducts } from "@/lib/finance";
import { money } from "@/lib/format";
import { EXPENSE_CATEGORIES, PAYMENT_LABEL, type PaymentMethod } from "@/lib/types";

const CHANNEL: Record<string, string> = { mostrador: "Mostrador", web: "Pedido en línea", whatsapp: "WhatsApp" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const periodo = (await searchParams).periodo ?? "mes";
  const range = rangeFor(periodo);
  const [fin, channels, top, daily] = await Promise.all([
    financeSummary(range),
    salesByChannel(range),
    topProducts(range),
    dailySales(range),
  ]);
  const avgTicket = fin.orders ? Math.round(fin.sales / fin.orders) : 0;

  return (
    <div className="space-y-6">
      <PageTitle actions={<PeriodTabs current={periodo} base="/admin/finanzas" />}>Finanzas · {range.label}</PageTitle>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Stat
          label="Ventas"
          value={money(fin.sales)}
          hint={`${fin.orders} ventas · ticket promedio ${money(avgTicket)}${fin.delivery ? ` · incluye ${money(fin.delivery)} de envíos` : ""}`}
        />
        <Stat
          label="Utilidad bruta"
          value={money(fin.grossProfit)}
          hint={`Margen ${Math.round(fin.grossMargin * 100)}% · costo de lo vendido ${money(fin.cogs)}`}
        />
        <Stat label="Gastos operativos" value={money(fin.operatingExpenses)} hint="Renta, servicios, sueldos… (sin resurtido)" />
        <Stat
          label="Utilidad neta"
          value={money(fin.netProfit)}
          tone={fin.netProfit >= 0 ? "good" : "bad"}
          hint="Utilidad bruta − gastos operativos"
        />
      </div>

      <div className="card text-sm">
        <h2 className="mb-2 font-semibold">Flujo de efectivo</h2>
        <div className="grid max-w-md gap-1">
          <Line label="Entró por ventas" value={fin.sales} />
          <Line label="Salió en gastos operativos" value={-fin.operatingExpenses} />
          <Line label="Salió en resurtido / compras" value={-fin.restock} />
          <div className="flex justify-between border-t border-cafe-100 pt-1 font-semibold">
            <span>Te queda</span>
            <span className={fin.cashFlow < 0 ? "text-red-700" : "text-green-700"}>{money(fin.cashFlow)}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-cafe-600">
          La utilidad usa el costo de cada producto vendido; el flujo usa lo que realmente pagaste en compras. Si compras mucho
          inventario de golpe, el flujo puede bajar aunque el negocio sea rentable.
        </p>
      </div>

      {daily.length > 1 && daily.length <= 62 && (
        <section className="card">
          <h2 className="mb-6 font-semibold">Ventas por día</h2>
          <Bars data={daily.map((d) => ({ label: d.day.slice(5), value: d.total, display: money(d.total) }))} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Productos más vendidos</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">Venta</th>
                <th className="text-right">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {top.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="text-right tabular-nums">{t.qty}</td>
                  <td className="text-right tabular-nums">{money(t.revenue)}</td>
                  <td className="text-right tabular-nums">{money(t.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Gastos por categoría</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Categoría</th>
                <th className="text-right">Pagado</th>
                <th className="text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {fin.expenses.map((e) => (
                <tr key={e.category}>
                  <td>{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                  <td className="text-right tabular-nums">{money(e.paid)}</td>
                  <td className="text-right tabular-nums text-amber-700">{e.pending ? money(e.pending) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card overflow-x-auto lg:col-span-2">
          <h2 className="mb-2 font-semibold">Ventas por canal y forma de pago</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Canal</th>
                <th>Pago</th>
                <th className="text-right">Ventas</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={`${c.channel}-${c.payment_method}`}>
                  <td>{CHANNEL[c.channel] ?? c.channel}</td>
                  <td>{PAYMENT_LABEL[c.payment_method as PaymentMethod] ?? c.payment_method}</td>
                  <td className="text-right tabular-nums">{c.orders}</td>
                  <td className="text-right tabular-nums">{money(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-cafe-700">{label}</span>
      <span className="tabular-nums">{money(value)}</span>
    </div>
  );
}
