"use client";

import { useMemo, useState, useTransition } from "react";
import { posSale } from "@/app/admin/actions";
import { money } from "@/lib/format";

type P = { id: number; name: string; category: string; price: number; maxQty: number };
type Method = "efectivo" | "tarjeta" | "transferencia";

export default function PosTerminal({ products }: { products: P[] }) {
  const [ticket, setTicket] = useState<Record<number, number>>({});
  const [category, setCategory] = useState("Todo");
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<Method>("efectivo");
  const [cash, setCash] = useState("");
  const [customer, setCustomer] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState(false); // ticket abierto en celular

  const categories = useMemo(() => ["Todo", ...new Set(products.map((p) => p.category))], [products]);
  const shown = products.filter(
    (p) =>
      (category === "Todo" || p.category === category) &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase())),
  );
  const lines = Object.entries(ticket)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === Number(id))!, qty }))
    .filter((l) => l.p && l.qty > 0);
  const total = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const cashCents = Math.round(Number(cash || 0) * 100);
  const change = method === "efectivo" && cash ? cashCents - total : 0;

  function add(p: P, d: number) {
    setMsg(null);
    setTicket((t) => {
      const q = Math.max(0, Math.min((t[p.id] ?? 0) + d, p.maxQty));
      const n = { ...t };
      if (q) n[p.id] = q;
      else delete n[p.id];
      return n;
    });
  }

  function charge() {
    start(async () => {
      const res = await posSale({
        items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })),
        paymentMethod: method,
        cashGiven: method === "efectivo" && cash ? cashCents : null,
        customerName: customer,
      });
      if (res.ok) {
        setMsg({
          ok: true,
          text: `Venta #${String(res.orderId).padStart(4, "0")} registrada · ${money(res.total)}${
            res.change > 0 ? ` · Cambio: ${money(res.change)}` : ""
          }`,
        });
        setTicket({});
        setCash("");
        setCustomer("");
        setSheet(false);
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  const quickCash = [total, 10000, 20000, 50000].filter((v, i, a) => v >= total && a.indexOf(v) === i && v > 0);

  const ticketPanel = (
    <>
        <h2 className="text-lg font-semibold">Ticket</h2>
        {lines.length === 0 ? (
          <p className="text-sm text-cafe-600">Toca un producto para agregarlo.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {lines.map((l) => (
              <li key={l.p.id} className="flex items-center gap-2">
                <button className="h-7 w-7 rounded-full bg-cafe-100" onClick={() => add(l.p, -1)}>
                  −
                </button>
                <span className="w-5 text-center">{l.qty}</span>
                <button className="h-7 w-7 rounded-full bg-cafe-100" onClick={() => add(l.p, 1)}>
                  +
                </button>
                <span className="flex-1 truncate">{l.p.name}</span>
                <span className="tabular-nums">{money(l.p.price * l.qty)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between border-t border-cafe-100 pt-3 text-xl font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>

        <input className="input" placeholder="Cliente (opcional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />

        <div className="grid grid-cols-3 gap-1">
          {(["efectivo", "tarjeta", "transferencia"] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`rounded-lg py-2 text-xs font-medium capitalize ${
                method === m ? "bg-cafe-800 text-white" : "bg-cafe-50 ring-1 ring-cafe-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {method === "efectivo" && (
          <div className="space-y-2">
            <input
              className="input text-lg"
              type="number"
              min={0}
              step="0.5"
              placeholder="Recibido"
              value={cash}
              onChange={(e) => setCash(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              {quickCash.map((v) => (
                <button key={v} className="btn-secondary px-2 py-1 text-xs" onClick={() => setCash(String(v / 100))}>
                  {v === total ? "Exacto" : money(v)}
                </button>
              ))}
            </div>
            {cash && (
              <p className={`text-lg font-semibold ${change < 0 ? "text-red-700" : "text-green-700"}`}>
                {change < 0 ? `Faltan ${money(-change)}` : `Cambio: ${money(change)}`}
              </p>
            )}
          </div>
        )}

        {msg && (
          <p className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
            {msg.text}
          </p>
        )}

        <button
          className="btn-primary w-full py-3 text-base"
          disabled={pending || lines.length === 0 || (method === "efectivo" && cash !== "" && change < 0)}
          onClick={charge}
        >
          {pending ? "Registrando…" : `Cobrar ${money(total)}`}
        </button>
        {lines.length > 0 && (
          <button className="w-full text-xs text-cafe-600 underline" onClick={() => setTicket({})}>
            Vaciar ticket
          </button>
        )}
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="min-w-0">
        <input
          className="input mb-2 lg:max-w-72"
          type="search"
          placeholder="Buscar producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm ${
                category === c ? "bg-cafe-800 text-white" : "bg-white ring-1 ring-cafe-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {msg?.ok && (
          <p className="mb-3 rounded-lg bg-green-50 p-2 text-sm text-green-800 lg:hidden">{msg.text}</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((p) => {
            const out = p.maxQty <= 0;
            const q = ticket[p.id] ?? 0;
            return (
              <button
                key={p.id}
                disabled={out || q >= p.maxQty}
                onClick={() => add(p, 1)}
                className="card relative p-3 text-left transition hover:border-cafe-300 active:scale-[0.97] disabled:opacity-40 lg:p-4"
              >
                <p className="pr-5 text-sm leading-snug font-medium lg:text-base">{p.name}</p>
                <p className="text-sm text-cafe-700">{money(p.price)}</p>
                {p.maxQty < 999 && <p className="text-xs text-cafe-500">{out ? "Agotado" : `Quedan ${p.maxQty}`}</p>}
                {q > 0 && (
                  <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-cafe-800 text-xs font-bold text-white">
                    {q}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Escritorio: ticket a la derecha */}
      <aside className="card hidden h-fit space-y-3 lg:sticky lg:top-4 lg:block">{ticketPanel}</aside>

      {/* Celular: barra con total arriba de la navegación */}
      {lines.length > 0 && !sheet && (
        <button
          onClick={() => setSheet(true)}
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between rounded-xl bg-cafe-800 px-4 py-3 text-white shadow-lg lg:hidden"
        >
          <span className="text-sm">
            🧾 {lines.reduce((a, l) => a + l.qty, 0)} producto(s) · <span className="underline">ver ticket</span>
          </span>
          <span className="text-lg font-semibold tabular-nums">Cobrar {money(total)}</span>
        </button>
      )}
      {sheet && (
        <div className="fixed inset-0 z-[60] bg-black/40 lg:hidden" onClick={() => setSheet(false)}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[90dvh] space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="mx-auto h-1 w-10 rounded-full bg-cafe-200" />
            </div>
            {ticketPanel}
            <button className="btn-secondary w-full" onClick={() => setSheet(false)}>
              Seguir agregando
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
