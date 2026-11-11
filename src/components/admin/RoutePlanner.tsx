"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RouteResult } from "@/lib/deliveryRoute";
import { money } from "@/lib/format";
import type { OrderStatus } from "@/lib/types";

export type PlannerOrder = {
  id: number;
  code: string;
  name: string;
  address: string;
  status: OrderStatus;
  km: number | null;
  total: number;
  paid: boolean;
  items: string;
  createdAt: string;
  /** "Hoy 8:15" si es programado */
  scheduled?: string | null;
};

const STATUS: Partial<Record<OrderStatus, { label: string; cls: string }>> = {
  nuevo: { label: "Nuevo", cls: "bg-amber-100 text-amber-800" },
  preparando: { label: "Listo para salir", cls: "bg-green-100 text-green-800" },
  en_camino: { label: "En camino", cls: "bg-indigo-100 text-indigo-800" },
};

const waPhone = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `52${d}` : d;
};

function collectText(s: { collect: number; cashGiven: number | null }) {
  if (!s.collect) return "Ya pagado";
  const change = s.cashGiven && s.cashGiven > s.collect ? s.cashGiven - s.collect : 0;
  return `Cobrar ${money(s.collect)}${s.cashGiven ? ` · paga con ${money(s.cashGiven)}` : ""}${change ? ` · lleva cambio ${money(change)}` : ""}`;
}

export type RouteActions = {
  plan: (orderIds: number[], returnToCafe: boolean) => Promise<RouteResult>;
  onTheWay: (orderIds: number[]) => Promise<void>;
  delivered: (orderId: number) => Promise<void>;
};

export default function RoutePlanner({
  orders,
  businessName,
  actions,
}: {
  orders: PlannerOrder[];
  businessName: string;
  actions: RouteActions;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(orders.filter((o) => o.status === "preparando" || o.status === "en_camino").map((o) => o.id)),
  );
  const [returnToCafe, setReturnToCafe] = useState(true);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function plan() {
    setMsg("");
    start(async () => {
      try {
        setResult(await actions.plan([...selected], returnToCafe));
        setDone(new Set());
      } catch {
        setResult({ ok: false, message: "No se pudo calcular la ruta. Intenta de nuevo." });
      }
    });
  }

  function onTheWay() {
    if (!result?.ok) return;
    start(async () => {
      await actions.onTheWay(result.stops.map((s) => s.orderId));
      setMsg("🛵 Pedidos marcados En camino. Los clientes ya lo ven en su seguimiento.");
      router.refresh();
    });
  }

  function delivered(orderId: number) {
    start(async () => {
      await actions.delivered(orderId);
      setDone((d) => new Set(d).add(orderId));
      router.refresh();
    });
  }

  function whatsappText(r: Extract<RouteResult, { ok: true }>) {
    const lines = [
      `🛵 *Ruta de reparto · ${businessName}*`,
      `${r.stops.length} parada${r.stops.length === 1 ? "" : "s"} · ${r.totalKm} km${r.totalMinutes ? ` · ~${r.totalMinutes} min` : ""}`,
      "",
      ...r.stops.flatMap((s, i) => [
        `*${i + 1}. ${s.code} · ${s.name}*`,
        `${s.address}${s.postalCode ? `, CP ${s.postalCode}` : ""}`,
        ...(s.addressRef ? [`Ref: ${s.addressRef}`] : []),
        `Tel: ${s.phone}`,
        collectText(s),
        `📍 https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`,
        "",
      ]),
      r.links.length === 1 ? `🧭 Ruta completa: ${r.links[0]}` : r.links.map((l, i) => `🧭 Tramo ${i + 1}: ${l}`).join("\n"),
    ];
    return lines.join("\n");
  }

  if (!orders.length) {
    return (
      <p className="card text-sm text-cafe-600">
        No hay pedidos a domicilio activos. Aquí aparecerán los pedidos a domicilio para planear la ruta del repartidor.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">1. Elige los pedidos que salen</h2>
          <button
            type="button"
            className="text-sm text-cafe-700 underline"
            onClick={() => setSelected(selected.size === orders.length ? new Set() : new Set(orders.map((o) => o.id)))}
          >
            {selected.size === orders.length ? "Quitar todos" : "Seleccionar todos"}
          </button>
        </div>
        <ul className="divide-y divide-cafe-100">
          {orders.map((o) => (
            <li key={o.id}>
              <label className="flex cursor-pointer items-start gap-3 py-2">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b>
                      {o.code} · {o.name}
                    </b>
                    <span className={`badge ${STATUS[o.status]?.cls ?? ""}`}>{STATUS[o.status]?.label ?? o.status}</span>
                  </span>
                  <span className="block truncate text-sm text-cafe-700">
                    📍 {o.address}
                    {o.km != null ? ` · ${o.km} km` : ""}
                  </span>
                  {o.scheduled && (
                    <span className="block text-xs font-bold text-amber-800">⏰ Programado: {o.scheduled}</span>
                  )}
                  <span className="block truncate text-xs text-cafe-500">{o.items}</span>
                </span>
                <span className="text-right text-sm">
                  <b>{money(o.total)}</b>
                  <span className="block text-xs text-cafe-600">{o.paid ? "Pagado" : "Por cobrar"}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={returnToCafe} onChange={(e) => setReturnToCafe(e.target.checked)} />
          El repartidor regresa a la cafetería al terminar
        </label>
        <button className="btn-primary w-full py-3" disabled={pending || selected.size === 0} onClick={plan}>
          {pending && !result ? "Calculando…" : `🗺️ Calcular mejor ruta (${selected.size})`}
        </button>
      </section>

      {result && !result.ok && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{result.message}</p>}

      {result?.ok && (
        <section className="card space-y-4">
          <div>
            <h2 className="font-semibold">2. Ruta de entrega</h2>
            <p className="text-sm text-cafe-700">
              {result.stops.length} parada{result.stops.length === 1 ? "" : "s"} · <b>{result.totalKm} km</b>
              {result.totalMinutes ? ` · ~${result.totalMinutes} min manejando` : ""}
              {result.returnToCafe ? " · con regreso" : ""}
            </p>
            {!result.optimized && (
              <p className="text-xs text-amber-700">
                Orden aproximado por cercanía (Google Maps no está disponible). Las distancias son estimadas.
              </p>
            )}
          </div>
          {result.missing.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
              ⚠️ No pudimos ubicar en el mapa: {result.missing.map((m) => `${m.code} (${m.name}, ${m.address})`).join("; ")}. Entrégalos
              aparte.
            </p>
          )}

          <ol className="space-y-3">
            <li className="flex items-center gap-3 text-sm text-cafe-600">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cafe-100">☕</span>
              Sale de {businessName}
            </li>
            {result.stops.map((s, i) => {
              const isDone = done.has(s.orderId);
              return (
                <li key={s.orderId} className={`rounded-xl border p-3 ${isDone ? "border-green-200 bg-green-50 opacity-70" : "border-cafe-100"}`}>
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cafe-800 font-bold text-white">
                      {isDone ? "✓" : i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1 text-sm">
                      <p className="text-xs text-cafe-500">
                        +{s.km} km{s.minutes ? ` · ~${s.minutes} min` : ""} desde la parada anterior
                      </p>
                      <p className="font-semibold">
                        {s.code} · {s.name}
                      </p>
                      <p>
                        {s.address}
                        {s.postalCode ? `, CP ${s.postalCode}` : ""}
                      </p>
                      {s.addressRef && <p className="text-cafe-600">Ref: {s.addressRef}</p>}
                      {s.notes && <p className="text-cafe-600">Notas: {s.notes}</p>}
                      <p className={s.collect ? "font-semibold text-amber-800" : "text-green-700"}>💵 {collectText(s)}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <a
                          className="btn-secondary px-3 py-1 text-xs"
                          href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          🧭 Ir aquí
                        </a>
                        <a className="btn-secondary px-3 py-1 text-xs" href={`tel:${s.phone}`}>
                          📞 Llamar
                        </a>
                        <a
                          className="btn-secondary px-3 py-1 text-xs"
                          href={`https://wa.me/${waPhone(s.phone)}?text=${encodeURIComponent(`¡Hola ${s.name}! Tu pedido ${s.code} de ${businessName} va en camino 🛵`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          💬 Avisar
                        </a>
                        {!isDone && (
                          <button className="btn-primary px-3 py-1 text-xs" disabled={pending} onClick={() => delivered(s.orderId)}>
                            ✅ Entregado
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
            {result.returnToCafe && result.back && (
              <li className="flex items-center gap-3 text-sm text-cafe-600">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cafe-100">☕</span>
                Regreso a la cafetería · +{result.back.km} km{result.back.minutes ? ` · ~${result.back.minutes} min` : ""}
              </li>
            )}
          </ol>

          <div className="grid gap-2 sm:grid-cols-3">
            {result.links.map((l, i) => (
              <a key={l} className="btn-primary" href={l} target="_blank" rel="noopener noreferrer">
                🧭 Abrir ruta en Google Maps{result.links.length > 1 ? ` (tramo ${i + 1})` : ""}
              </a>
            ))}
            <a
              className="btn-whatsapp"
              href={`https://wa.me/?text=${encodeURIComponent(whatsappText(result))}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              💬 Enviar ruta por WhatsApp
            </a>
            {result.stops.some((s) => s.status === "nuevo" || s.status === "preparando") && (
              <button className="btn-secondary" disabled={pending} onClick={onTheWay}>
                🛵 Marcar todos En camino
              </button>
            )}
          </div>
          {msg && <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800">{msg}</p>}
        </section>
      )}
    </div>
  );
}
