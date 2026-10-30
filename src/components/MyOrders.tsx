"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dateTime, money } from "@/lib/format";
import {
  addToSavedCart,
  loadMyOrders,
  MY_ORDERS_EVENT,
  rememberOrder,
} from "@/lib/myOrders";
import { CUSTOMER_STATUS, customerSteps } from "@/lib/orderStatus";
import type { OrderStatus } from "@/lib/types";
import {
  FREE_NOTE,
  normalizePhone,
  type LoyaltySettings,
  type LoyaltyStatus,
} from "@/lib/loyaltyRules";
import LoyaltyCard, { LoyaltyRulesText } from "./LoyaltyCard";

type MyOrder = {
  id: number;
  token: string;
  status: OrderStatus;
  payment_status: string;
  payment_method: string;
  delivery_type: string;
  total: number;
  created_at: string;
  items: {
    name: string;
    qty: number;
    productId: number | null;
    note: string;
  }[];
};

const code = (id: number) => `#${String(id).padStart(4, "0")}`;
export const isActive = (o: MyOrder) =>
  o.status !== "entregado" && o.status !== "cancelado";

/** Pedidos de este dispositivo; con `live` escucha en tiempo real el pedido en curso. */
export function useMyOrders(live = false) {
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const refs = loadMyOrders();
    if (!refs.length) {
      setOrders([]);
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(
        `/api/orders/status?tokens=${refs.map((r) => r.token).join(",")}`,
        { cache: "no-store" },
      );
      if (res.ok) setOrders((await res.json()).orders);
    } catch {}
    setLoaded(true);
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

  // Mientras haya un pedido en curso: respaldo periódico y (con live) aviso en tiempo real del más reciente
  const active = orders.filter(isActive);
  const liveToken = live ? active[0]?.token : undefined;
  useEffect(() => {
    if (!active.length) return;
    const t = setInterval(refresh, live ? 20_000 : 60_000);
    return () => clearInterval(t);
  }, [active.length, live, refresh]);
  useEffect(() => {
    if (!liveToken || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/live/pedido/${liveToken}`);
    let first = true;
    es.onmessage = () => {
      if (first)
        first = false; // el primer mensaje es solo la línea base
      else refresh();
    };
    return () => es.close();
  }, [liveToken, refresh]);

  return { orders, active, loaded, refresh };
}

/** Aviso del pedido en curso (arriba del menú). */
export function ActiveOrderBanner() {
  const { active } = useMyOrders(true);
  const latest = active[0];
  if (!latest) return null;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-3">
      <Link
        href={`/pedido/${latest.token}`}
        className="flex items-center gap-3 rounded-2xl bg-cafe-800 px-4 py-3 text-white shadow"
      >
        <span className="text-2xl">{CUSTOMER_STATUS[latest.status].icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-cafe-200">
            Tu pedido {code(latest.id)}
          </span>
          <span className="block font-semibold">
            {CUSTOMER_STATUS[latest.status].label}
          </span>
        </span>
        <span className="text-sm text-cafe-200">Ver ›</span>
      </Link>
    </div>
  );
}

/** Pestaña "Pedidos": en curso, anteriores (con "Pedir de nuevo") y búsqueda desde otro celular. */
export function MyOrdersView() {
  const router = useRouter();
  const { orders, active, loaded, refresh } = useMyOrders(true);
  const [lookup, setLookup] = useState({ code: "", phone: "" });
  const [lookupMsg, setLookupMsg] = useState("");
  const [searching, setSearching] = useState(false);
  const past = orders.filter((o) => !isActive(o));

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
      refresh();
    } catch (err) {
      setLookupMsg(err instanceof Error ? err.message : "No se pudo buscar");
    } finally {
      setSearching(false);
    }
  }

  function reorder(o: MyOrder) {
    addToSavedCart(
      o.items.map((i) => ({
        productId: i.productId,
        qty: i.qty,
        note: i.note === FREE_NOTE ? "" : i.note,
      })),
    );
    router.push("/?pedido=1");
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-lg font-bold">En curso</h2>
        {loaded && active.length === 0 && (
          <div className="rounded-2xl bg-white p-5 text-center text-sm text-cafe-600 shadow-sm">
            <p className="text-3xl">☕</p>
            <p className="mt-1">No tienes pedidos en curso.</p>
            <Link href="/" className="btn-primary mt-3 inline-flex">
              Ver el menú
            </Link>
          </div>
        )}
        {active.map((o) => (
          <OrderCard key={o.token} o={o} />
        ))}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Anteriores</h2>
          {past.map((o) => (
            <div key={o.token} className="space-y-2">
              <OrderCard o={o} />
              {o.status === "entregado" && o.items.some((i) => i.productId) && (
                <button
                  onClick={() => reorder(o)}
                  className="btn-secondary w-full"
                >
                  🔁 Pedir de nuevo
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <form
        onSubmit={find}
        className="space-y-2 rounded-2xl bg-white p-4 text-sm shadow-sm"
      >
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
      <p className="text-center text-xs text-cafe-500">
        Guardamos en este celular los pedidos de los últimos 7 días.
      </p>
    </div>
  );
}

/** Pestaña "Recompensas": tarjeta de sellos del teléfono guardado en este celular. */
export function RewardsView({ rules }: { rules: LoyaltySettings }) {
  const [phone, setPhone] = useState("");
  const [card, setCard] = useState<LoyaltyStatus | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("cafe_customer_v1") || "{}",
      ).phone;
      if (saved) setPhone(saved); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);
  const key = normalizePhone(phone);
  useEffect(() => {
    if (!key) return setCard(null); // eslint-disable-line react-hooks/set-state-in-effect
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/lealtad?phone=${key}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          setCard(d.status);
          setChecked(true);
        })
        .catch(() => {});
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key]);

  return (
    <div className="space-y-4">
      <LoyaltyCard
        status={card ?? { stamps: 0, needed: rules.needed, rewards: [] }}
      />
      <div className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <label className="label" htmlFor="rewards-phone">
          Tu teléfono
        </label>
        <input
          id="rewards-phone"
          className="input"
          type="tel"
          inputMode="tel"
          placeholder="10 dígitos"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="text-xs text-cafe-600">
          {key
            ? checked
              ? "Estos son los sellos de este número."
              : "Buscando tus sellos…"
            : "Escribe el número con el que haces tus pedidos."}
        </p>
      </div>
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-bold">¿Cómo funciona?</h2>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="text-2xl">📱</span>
            <span>
              Da tu teléfono al pagar en el café o al pedir aquí en línea.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-2xl">☕</span>
            <span>
              Ganas 1 sello por día en compras desde $
              {(rules.minPurchase / 100).toFixed(0)}.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-2xl">🎁</span>
            <span>
              Con {rules.needed} sellos te regalamos una bebida de hasta 12oz.
              Úsala en la caja o en tu siguiente pedido en línea.
            </span>
          </li>
        </ol>
        <LoyaltyRulesText rules={rules} />
      </div>
    </div>
  );
}

function OrderCard({ o }: { o: MyOrder }) {
  const steps = customerSteps(o.delivery_type);
  const current = steps.indexOf(o.status);
  const st = CUSTOMER_STATUS[o.status];
  return (
    <Link
      href={`/pedido/${o.token}`}
      className="block space-y-3 rounded-xl bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">Pedido {code(o.id)}</p>
          <p className="text-xs text-cafe-600">
            {dateTime(o.created_at)} ·{" "}
            {o.delivery_type === "domicilio"
              ? "🛵 A domicilio"
              : "🏪 Para recoger"}
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
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${i <= current ? "bg-cafe-700" : "bg-cafe-100"}`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-cafe-500">
            {steps.map((s, i) => (
              <span
                key={s}
                className={i === current ? "font-bold text-cafe-800" : ""}
              >
                {CUSTOMER_STATUS[s].label}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="line-clamp-2 text-sm text-cafe-700">
        {o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}
      </p>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{money(o.total)}</span>
        <span className="text-cafe-600">
          {o.payment_status === "pagado"
            ? "Pagado"
            : o.status === "pago_pendiente"
              ? "Pago pendiente"
              : "Pagas al recibir"}{" "}
          · Ver detalle ›
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
