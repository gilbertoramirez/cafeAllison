"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dateTime, money } from "@/lib/format";
import { loadMyOrders, MY_ORDERS_EVENT, rememberOrder } from "@/lib/myOrders";
import { CUSTOMER_STATUS, customerSteps } from "@/lib/orderStatus";
import type { OrderStatus } from "@/lib/types";

type MyOrder = {
  id: number;
  token: string;
  status: OrderStatus;
  payment_status: string;
  payment_method: string;
  delivery_type: string;
  total: number;
  created_at: string;
  items: { name: string; qty: number }[];
};

const code = (id: number) => `#${String(id).padStart(4, "0")}`;
const isActive = (o: MyOrder) => o.status !== "entregado" && o.status !== "cancelado";

/** "Mis pedidos": aviso del pedido en curso + panel con el progreso de los pedidos de este dispositivo. */
export default function MyOrders() {
  const router = useRouter();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState({ code: "", phone: "" });
  const [lookupMsg, setLookupMsg] = useState("");
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    const refs = loadMyOrders();
    if (!refs.length) return setOrders([]);
    try {
      const res = await fetch(`/api/orders/status?tokens=${refs.map((r) => r.token).join(",")}`, { cache: "no-store" });
      if (res.ok) setOrders((await res.json()).orders);
    } catch {}
  }, []);

  useEffect(() => {
    refresh(); // eslint-disable-line react-hooks/set-state-in-effect
    const onChange = () => refresh();
    window.addEventListener(MY_ORDERS_EVENT, onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      window.removeEventListener(MY_ORDERS_EVENT, onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [refresh]);

  // Mientras haya un pedido en curso: aviso en tiempo real del más reciente y respaldo cada 20 s
  const active = orders.filter(isActive);
  const liveToken = active[0]?.token;
  useEffect(() => {
    if (!active.length) return;
    const t = setInterval(refresh, 20_000);
    return () => clearInterval(t);
  }, [active.length, refresh]);
  useEffect(() => {
    if (!liveToken || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/live/pedido/${liveToken}`);
    let first = true;
    es.onmessage = () => {
      if (first) first = false; // el primer mensaje es solo la línea base
      else refresh();
    };
    return () => es.close();
  }, [liveToken, refresh]);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setLookupMsg("");
    try {
      const res = await fetch("/api/orders/buscar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lookup),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      rememberOrder(data.token);
      setLookup({ code: "", phone: "" });
      setLookupMsg("¡Listo! Agregamos tu pedido.");
    } catch (err) {
      setLookupMsg(err instanceof Error ? err.message : "No se pudo buscar");
    } finally {
      setSearching(false);
    }
  }

  const latest = active[0];

  return (
    <>
      {/* Aviso del pedido en curso (o acceso a "Mis pedidos") */}
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 pt-3">
        {latest ? (
          <button
            onClick={() => router.push(`/pedido/${latest.token}`)}
            className="flex flex-1 items-center gap-3 rounded-2xl bg-cafe-800 px-4 py-3 text-left text-white shadow"
          >
            <span className="text-2xl">{CUSTOMER_STATUS[latest.status].icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-cafe-200">Tu pedido {code(latest.id)}</span>
              <span className="block font-semibold">{CUSTOMER_STATUS[latest.status].label}</span>
            </span>
            <span className="text-sm text-cafe-200">Ver ›</span>
          </button>
        ) : (
          <span className="flex-1" />
        )}
        <button
          onClick={() => {
            setOpen(true);
            refresh();
          }}
          className="relative shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-cafe-800 ring-1 ring-cafe-200"
        >
          🧾 Mis pedidos
          {active.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] text-white">
              {active.length}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Mis pedidos"
            className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-cafe-50 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-cafe-100 bg-white px-5 py-4">
              <h2 className="text-lg font-bold">Mis pedidos</h2>
              <button onClick={() => setOpen(false)} aria-label="Cerrar" className="text-2xl leading-none text-cafe-600">
                ×
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto p-4">
              {orders.length === 0 && (
                <p className="rounded-xl bg-white p-4 text-sm text-cafe-600">
                  Aquí verás tus pedidos y cómo van. Todavía no hay pedidos en este celular.
                </p>
              )}
              {orders.map((o) => (
                <OrderCard key={o.token} o={o} />
              ))}

              <form onSubmit={find} className="space-y-2 rounded-xl bg-white p-4 text-sm">
                <p className="font-semibold">¿Pediste desde otro celular?</p>
                <div className="flex gap-2">
                  <input
                    className="input w-28"
                    placeholder="# pedido"
                    inputMode="numeric"
                    value={lookup.code}
                    onChange={(e) => setLookup({ ...lookup, code: e.target.value })}
                    required
                  />
                  <input
                    className="input flex-1"
                    placeholder="Tu teléfono"
                    type="tel"
                    inputMode="tel"
                    value={lookup.phone}
                    onChange={(e) => setLookup({ ...lookup, phone: e.target.value })}
                    required
                  />
                </div>
                <button className="btn-secondary w-full" disabled={searching}>
                  {searching ? "Buscando…" : "Buscar mi pedido"}
                </button>
                {lookupMsg && <p className="text-cafe-700">{lookupMsg}</p>}
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OrderCard({ o }: { o: MyOrder }) {
  const steps = customerSteps(o.delivery_type);
  const current = steps.indexOf(o.status);
  const st = CUSTOMER_STATUS[o.status];
  return (
    <Link href={`/pedido/${o.token}`} className="block space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Pedido {code(o.id)}</p>
          <p className="text-xs text-cafe-600">
            {dateTime(o.created_at)} · {o.delivery_type === "domicilio" ? "🛵 A domicilio" : "🏪 Para recoger"}
          </p>
        </div>
        <span
          className={`badge ${
            o.status === "cancelado"
              ? "bg-gray-200 text-gray-600"
              : o.status === "entregado"
                ? "bg-green-100 text-green-800"
                : o.status === "pago_pendiente"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-cafe-100 text-cafe-800"
          }`}
        >
          {st.icon} {st.label}
        </span>
      </div>

      {o.status !== "cancelado" && o.status !== "pago_pendiente" && (
        <div>
          <div className="flex gap-1">
            {steps.map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= current ? "bg-cafe-700" : "bg-cafe-100"}`} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-cafe-500">
            {steps.map((s, i) => (
              <span key={s} className={i === current ? "font-bold text-cafe-800" : ""}>
                {CUSTOMER_STATUS[s].label}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="line-clamp-2 text-sm text-cafe-700">{o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</p>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{money(o.total)}</span>
        <span className="text-cafe-600">
          {o.payment_status === "pagado" ? "Pagado" : o.status === "pago_pendiente" ? "Pago pendiente" : "Pagas al recibir"} · Ver
          detalle ›
        </span>
      </div>
    </Link>
  );
}

/** Guarda en este dispositivo un pedido que se abrió (p. ej. desde un link de WhatsApp). */
export function RememberOrder({ token }: { token: string }) {
  useEffect(() => rememberOrder(token), [token]);
  return null;
}
