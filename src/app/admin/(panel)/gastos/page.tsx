import { Field, PageTitle, PeriodTabs } from "@/components/admin/ui";
import { all } from "@/lib/db";
import { rangeFor } from "@/lib/finance";
import { localDate, money } from "@/lib/format";
import type { Expense } from "@/lib/types";
import { EXPENSE_CATEGORIES } from "@/lib/types";
import { deleteExpense, payExpense, saveExpense } from "../../actions";

const RECURRING: Record<string, string> = { none: "", monthly: "Mensual", weekly: "Semanal" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  const periodo = (await searchParams).periodo ?? "mes";
  const range = rangeFor(periodo);
  const today = localDate();
  const [pending, paid] = await Promise.all([
    all<Expense>("SELECT * FROM expenses WHERE status = 'pendiente' ORDER BY date"),
    all<Expense>("SELECT * FROM expenses WHERE status = 'pagado' AND date >= ? AND date <= ? ORDER BY date DESC, id DESC", [
      range.from,
      range.to,
    ]),
  ]);
  const pendingTotal = pending.reduce((a, e) => a + e.amount, 0);
  const paidTotal = paid.reduce((a, e) => a + e.amount, 0);

  return (
    <div className="space-y-6">
      <PageTitle>Gastos</PageTitle>

      <form action={saveExpense} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-6">Registrar gasto o pago por hacer</h2>
        <Field label="Categoría">
          <select name="category" className="input" required>
            {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Descripción" className="lg:col-span-2">
          <input name="description" className="input" placeholder="Renta del local, recibo CFE…" />
        </Field>
        <Field label="Monto ($)">
          <input name="amount" type="number" step="0.01" min="0.01" className="input" required />
        </Field>
        <Field label="Fecha / vence">
          <input name="date" type="date" className="input" defaultValue={today} required />
        </Field>
        <Field label="Estado">
          <select name="status" className="input">
            <option value="pagado">Ya pagado</option>
            <option value="pendiente">Por pagar</option>
          </select>
        </Field>
        <Field label="Se repite" hint="Al pagarlo se agenda el siguiente automáticamente.">
          <select name="recurring" className="input">
            <option value="none">No</option>
            <option value="monthly">Cada mes</option>
            <option value="weekly">Cada semana</option>
          </select>
        </Field>
        <div className="flex items-end sm:col-span-2 lg:col-span-5">
          <button className="btn-primary">Guardar</button>
        </div>
      </form>

      <section className="card overflow-x-auto">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Por pagar</h2>
          <span className="font-semibold text-amber-700">{money(pendingTotal)}</span>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-cafe-600">No tienes pagos pendientes.</p>
        ) : (
          <table className="data-table">
            <tbody>
              {pending.map((e) => (
                <tr key={e.id}>
                  <td className={`whitespace-nowrap ${e.date < today ? "font-semibold text-red-700" : ""}`}>
                    {e.date}
                    {e.date < today && " · vencido"}
                  </td>
                  <td className="hidden sm:table-cell">{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                  <td>
                    <span className="block text-xs text-cafe-600 sm:hidden">{EXPENSE_CATEGORIES[e.category] ?? e.category}</span>
                    {e.description} {e.recurring !== "none" && <span className="badge bg-cafe-100">{RECURRING[e.recurring]}</span>}
                  </td>
                  <td className="text-right font-medium tabular-nums">{money(e.amount)}</td>
                  <td className="text-right">
                    <form action={payExpense.bind(null, e.id)} className="inline">
                      <button className="btn-primary px-3 py-1">Pagar</button>
                    </form>
                    <form action={deleteExpense.bind(null, e.id)} className="mt-1 block sm:ml-2 sm:inline">
                      <button className="text-xs text-red-700 underline">Borrar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            Pagados · {range.label} · <span className="text-cafe-700">{money(paidTotal)}</span>
          </h2>
          <PeriodTabs current={periodo} base="/admin/gastos" />
        </div>
        {paid.length === 0 ? (
          <p className="text-sm text-cafe-600">Sin gastos en este periodo.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="hidden sm:table-cell">Categoría</th>
                <th>Descripción</th>
                <th className="text-right">Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paid.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{e.date}</td>
                  <td className="hidden sm:table-cell">{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
                  <td>
                    <span className="block text-xs text-cafe-600 sm:hidden">{EXPENSE_CATEGORIES[e.category] ?? e.category}</span>
                    {e.description}
                  </td>
                  <td className="text-right tabular-nums">{money(e.amount)}</td>
                  <td className="text-right">
                    <form action={deleteExpense.bind(null, e.id)}>
                      <button className="text-xs text-red-700 underline">Borrar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
