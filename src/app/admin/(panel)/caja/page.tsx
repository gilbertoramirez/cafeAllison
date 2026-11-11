import Link from "next/link";
import { Field, PageTitle } from "@/components/admin/ui";
import PrintPageButton from "@/components/admin/PrintPageButton";
import { currentSession, recentSessions, sessionById, sessionMovements, sessionSummary, type CashSession, type CashSummary } from "@/lib/cash";
import { dateTime, money } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/types";
import { cashMovement, closeCash, openCash } from "../../actions";

export const dynamic = "force-dynamic";

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""} ${tone ?? ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Difference({ counted, expected }: { counted: number; expected: number }) {
  const d = counted - expected;
  if (d === 0) return <p className="rounded-lg bg-green-50 p-3 text-center text-lg font-bold text-green-800">✓ La caja cuadra</p>;
  return (
    <p className={`rounded-lg p-3 text-center text-lg font-bold ${d > 0 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>
      {d > 0 ? `Sobran ${money(d)}` : `Faltan ${money(-d)}`}
    </p>
  );
}

function SummaryCard({ s, summary, title }: { s: CashSession; summary: CashSummary; title: string }) {
  return (
    <section className="card space-y-3 text-sm">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-cafe-600">
          {dateTime(summary.from)} → {s.closed_at ? dateTime(s.closed_at) : "ahora"}
        </p>
      </div>
      <div className="space-y-1">
        <p className="font-medium">Ventas del turno ({summary.salesCount})</p>
        {summary.byMethod.length === 0 && <p className="text-cafe-600">Sin ventas todavía.</p>}
        {summary.byMethod.map((m) => (
          <Row key={m.method} label={`${PAYMENT_LABEL[m.method] ?? m.method} (${m.count})`} value={money(m.total)} />
        ))}
        <Row label="Total vendido" value={money(summary.sales)} strong />
        {summary.salesCount > 0 && <Row label="Ticket promedio" value={money(Math.round(summary.sales / summary.salesCount))} tone="text-cafe-600" />}
        {summary.cancelled.count > 0 && (
          <Row label={`Canceladas (${summary.cancelled.count})`} value={money(summary.cancelled.total)} tone="text-cafe-600" />
        )}
      </div>
      <div className="space-y-1 border-t border-cafe-100 pt-2">
        <p className="font-medium">Efectivo en el cajón</p>
        <Row label="Fondo inicial" value={money(summary.opening)} />
        <Row label="+ Ventas en efectivo" value={money(summary.cashSales)} />
        {summary.entradas > 0 && <Row label="+ Entradas" value={money(summary.entradas)} />}
        {summary.salidas > 0 && <Row label="− Salidas" value={money(summary.salidas)} />}
        <Row label="= Debe haber" value={money(summary.expected)} strong />
        {s.counted_cash != null && <Row label="Contado" value={money(s.counted_cash)} strong />}
      </div>
      {summary.byMethod.some((m) => m.method === "whatsapp") && (
        <p className="text-xs text-cafe-600">Los pedidos “Acordado por WhatsApp” no se suman al efectivo esperado: revisa cómo se pagaron.</p>
      )}
      {summary.top.length > 0 && (
        <p className="text-cafe-600">
          Más vendidos: {summary.top.map((t) => `${t.name} (${t.qty})`).join(", ")}
        </p>
      )}
    </section>
  );
}

export default async function CashPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  const viewId = typeof sp.id === "string" ? Number(sp.id) : null;
  const messages = (
    <>
      {ok && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 print:hidden">✓ {ok}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 print:hidden">{error}</p>}
    </>
  );

  // Detalle de un corte ya cerrado
  if (viewId) {
    const s = await sessionById(viewId);
    if (s?.closed_at) {
      const [summary, moves] = await Promise.all([sessionSummary(s), sessionMovements(s.id)]);
      return (
        <div className="max-w-xl space-y-4">
          <PageTitle>Corte de caja #{s.id}</PageTitle>
          {messages}
          <Difference counted={s.counted_cash ?? 0} expected={s.expected_cash ?? summary.expected} />
          <SummaryCard s={s} summary={summary} title="Resumen del turno" />
          {moves.length > 0 && (
            <section className="card space-y-1 text-sm">
              <h2 className="font-semibold">Entradas y salidas</h2>
              {moves.map((m) => (
                <Row key={m.id} label={`${m.kind === "entrada" ? "+" : "−"} ${m.reason}`} value={money(m.amount)} />
              ))}
            </section>
          )}
          {s.close_note && <p className="card text-sm">Nota: {s.close_note}</p>}
          <div className="flex gap-2 print:hidden">
            <PrintPageButton />
            <Link href="/admin/caja" className="btn-secondary">
              Volver
            </Link>
          </div>
        </div>
      );
    }
  }

  const [s, history] = await Promise.all([currentSession(), recentSessions(20)]);
  const summary = s ? await sessionSummary(s) : null;
  const moves = s ? await sessionMovements(s.id) : [];
  const last = history.find((h) => h.closed_at);

  return (
    <div className="max-w-xl space-y-4">
      <PageTitle>Corte de caja</PageTitle>
      {messages}

      {!s || !summary ? (
        <form action={openCash} className="card space-y-3 text-sm">
          <h2 className="font-semibold">🔓 Abrir caja</h2>
          <p className="text-cafe-600">Cuenta el efectivo con el que empiezas el turno (fondo para dar cambio).</p>
          <Field label="Fondo inicial ($)">
            <input name="opening" type="number" step="0.5" min="0" className="input text-lg" placeholder="500" required />
          </Field>
          <Field label="Nota (opcional)">
            <input name="note" className="input" placeholder="Turno mañana, quién abre…" />
          </Field>
          <button className="btn-primary w-full py-3">Abrir caja</button>
          {last && (
            <p className="text-xs text-cafe-600">
              Último corte: {dateTime(last.closed_at!)} · contado {money(last.counted_cash ?? 0)}
            </p>
          )}
        </form>
      ) : (
        <>
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
            🟢 Caja abierta desde {dateTime(s.opened_at)} con fondo de {money(s.opening_cash)}
            {s.open_note ? ` · ${s.open_note}` : ""}
          </p>
          <SummaryCard s={s} summary={summary} title="Turno en curso" />

          <form action={cashMovement} className="card space-y-3 text-sm">
            <h2 className="font-semibold">↕️ Entrada o salida de efectivo</h2>
            <p className="text-cafe-600">Ej. pagaste al proveedor con dinero del cajón, retiraste efectivo o metiste cambio.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo">
                <select name="kind" className="input">
                  <option value="salida">− Salida</option>
                  <option value="entrada">+ Entrada</option>
                </select>
              </Field>
              <Field label="Monto ($)">
                <input name="amount" type="number" step="0.5" min="0.5" className="input" required />
              </Field>
            </div>
            <Field label="Motivo">
              <input name="reason" className="input" placeholder="Pago de leche, retiro, cambio…" required />
            </Field>
            <button className="btn-secondary">Registrar</button>
            {moves.length > 0 && (
              <div className="space-y-1 border-t border-cafe-100 pt-2">
                {moves.map((m) => (
                  <Row key={m.id} label={`${m.kind === "entrada" ? "+" : "−"} ${m.reason} · ${dateTime(m.created_at).split(", ")[1] ?? ""}`} value={money(m.amount)} />
                ))}
              </div>
            )}
          </form>

          <form action={closeCash} className="card space-y-3 text-sm">
            <h2 className="font-semibold">🔒 Cerrar caja</h2>
            <p className="text-cafe-600">
              Cuenta todo el efectivo del cajón. Debe haber <b>{money(summary.expected)}</b>.
            </p>
            <Field label="Efectivo contado ($)">
              <input name="counted" type="number" step="0.5" min="0" className="input text-lg" required />
            </Field>
            <Field label="Nota (opcional)">
              <input name="note" className="input" placeholder="Quién cierra, observaciones…" />
            </Field>
            <button className="btn-primary w-full py-3">Cerrar caja y hacer corte</button>
          </form>
        </>
      )}

      {history.some((h) => h.closed_at) && (
        <section className="card text-sm">
          <h2 className="mb-2 font-semibold">Cortes anteriores</h2>
          <ul className="divide-y divide-cafe-100">
            {history
              .filter((h) => h.closed_at)
              .map((h) => {
                const d = (h.counted_cash ?? 0) - (h.expected_cash ?? 0);
                return (
                  <li key={h.id}>
                    <Link href={`/admin/caja?id=${h.id}`} className="flex items-center justify-between gap-2 py-2">
                      <span>
                        #{h.id} · {dateTime(h.closed_at!)}
                      </span>
                      <span className={d === 0 ? "text-green-700" : d > 0 ? "text-amber-700" : "text-red-700"}>
                        {d === 0 ? "Cuadró" : d > 0 ? `Sobró ${money(d)}` : `Faltó ${money(-d)}`} ›
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}
