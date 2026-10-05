"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";

export type ShopProduct = {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  image_url: string;
  soldOut: boolean;
  maxQty: number;
};

type ShopSettings = {
  open: boolean;
  deliveryEnabled: boolean;
  deliveryFee: number;
  minDeliveryOrder: number;
  whatsapp: boolean;
  stripe: boolean;
};

type Cart = Record<number, number>;
const CART_KEY = "cafe_cart_v1";
const CUSTOMER_KEY = "cafe_customer_v1";

export default function Shop({ products, settings }: { products: ShopProduct[]; settings: ShopSettings }) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>({});
  const [step, setStep] = useState<"menu" | "checkout">("menu");
  const [showCart, setShowCart] = useState(false);
  const [category, setCategory] = useState<string>("Todo");
  const [loaded, setLoaded] = useState(false);

  // Datos del cliente
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveryType, setDeliveryType] = useState<"domicilio" | "recoger">(
    settings.deliveryEnabled ? "domicilio" : "recoger",
  );
  const [address, setAddress] = useState("");
  const [addressRef, setAddressRef] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<"stripe" | "efectivo" | "whatsapp">(
    settings.stripe ? "stripe" : "efectivo",
  );
  const [cashGiven, setCashGiven] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [locating, setLocating] = useState(false);

  // Restaura carrito y datos del cliente guardados en este dispositivo (después de hidratar).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(CART_KEY) || "{}") as Cart;
      const valid: Cart = {};
      for (const [id, q] of Object.entries(c)) {
        const p = products.find((x) => x.id === Number(id));
        if (p && !p.soldOut && q > 0) valid[p.id] = Math.min(q, p.maxQty);
      }
      setCart(valid);
      const cust = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || "{}");
      if (cust.name) setName(cust.name);
      if (cust.phone) setPhone(cust.phone);
      if (cust.address) setAddress(cust.address);
      if (cust.addressRef) setAddressRef(cust.addressRef);
    } catch {}
    setLoaded(true);
  }, [products]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {}
  }, [cart, loaded]);

  const categories = useMemo(() => ["Todo", ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const visible = category === "Todo" ? products : products.filter((p) => p.category === category);
  const grouped = useMemo(() => {
    const m = new Map<string, ShopProduct[]>();
    for (const p of visible) {
      if (!m.has(p.category)) m.set(p.category, []);
      m.get(p.category)!.push(p);
    }
    return [...m.entries()];
  }, [visible]);

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === Number(id))!, qty }))
    .filter((l) => l.p && l.qty > 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const fee = deliveryType === "domicilio" ? settings.deliveryFee : 0;
  const total = subtotal + fee;
  const belowMin = deliveryType === "domicilio" && subtotal < settings.minDeliveryOrder;

  function add(p: ShopProduct, delta: number) {
    setCart((c) => {
      const q = Math.max(0, Math.min((c[p.id] ?? 0) + delta, p.maxQty));
      const next = { ...c };
      if (q === 0) delete next[p.id];
      else next[p.id] = q;
      return next;
    });
  }

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setError("No pudimos obtener tu ubicación. Escribe tu dirección completa.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (belowMin) {
      setError(`El pedido mínimo para entrega a domicilio es ${money(settings.minDeliveryOrder)}.`);
      return;
    }
    setSending(true);
    try {
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name, phone, address, addressRef }));
    } catch {}
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })),
          customerName: name,
          phone,
          deliveryType,
          address,
          addressRef,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          notes,
          paymentMethod: payment,
          cashGiven: payment === "efectivo" && cashGiven ? Number(cashGiven) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el pedido");
      setCart({});
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      } else {
        router.push(`/pedido/${data.token}${payment === "whatsapp" ? "?wa=1" : ""}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
      setSending(false);
    }
  }

  if (step === "checkout") {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <button className="mb-4 text-sm text-cafe-700 underline" onClick={() => setStep("menu")}>
          ← Seguir viendo el menú
        </button>
        <h2 className="mb-4 text-2xl font-semibold">Tu pedido</h2>
        <form onSubmit={submit} className="space-y-5">
          <section className="card space-y-2">
            {lines.map((l) => (
              <div key={l.p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {l.qty} × {l.p.name}
                </span>
                <span className="font-medium">{money(l.p.price * l.qty)}</span>
              </div>
            ))}
          </section>

          <section className="card space-y-3">
            <h3 className="font-semibold">¿Cómo lo quieres recibir?</h3>
            <div className="grid grid-cols-2 gap-2">
              {settings.deliveryEnabled && (
                <Choice active={deliveryType === "domicilio"} onClick={() => setDeliveryType("domicilio")}>
                  🛵 A domicilio
                  <span className="block text-xs font-normal opacity-75">Envío {money(settings.deliveryFee)}</span>
                </Choice>
              )}
              <Choice active={deliveryType === "recoger"} onClick={() => setDeliveryType("recoger")}>
                🏪 Paso a recoger
                <span className="block text-xs font-normal opacity-75">Sin costo</span>
              </Choice>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Nombre</label>
                <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label">Teléfono / WhatsApp</label>
                <input
                  className="input"
                  required
                  type="tel"
                  inputMode="tel"
                  pattern="[0-9 +()-]{10,}"
                  title="Al menos 10 dígitos"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            {deliveryType === "domicilio" && (
              <>
                <div>
                  <label className="label">Dirección de entrega</label>
                  <input
                    className="input"
                    required
                    placeholder="Calle, número, colonia"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Referencias (opcional)</label>
                  <input
                    className="input"
                    placeholder="Portón negro, entre calles…"
                    value={addressRef}
                    onChange={(e) => setAddressRef(e.target.value)}
                  />
                </div>
                <button type="button" className="btn-secondary" onClick={locate} disabled={locating}>
                  📍 {coords ? "Ubicación agregada ✓" : locating ? "Obteniendo ubicación…" : "Compartir mi ubicación"}
                </button>
              </>
            )}
            <div>
              <label className="label">Notas para tu pedido (opcional)</label>
              <textarea
                className="input"
                rows={2}
                placeholder="Leche deslactosada, sin azúcar…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </section>

          <section className="card space-y-3">
            <h3 className="font-semibold">Forma de pago</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {settings.stripe && (
                <Choice active={payment === "stripe"} onClick={() => setPayment("stripe")}>
                  💳 Pagar en línea
                  <span className="block text-xs font-normal opacity-75">Tarjeta, seguro con Stripe</span>
                </Choice>
              )}
              <Choice active={payment === "efectivo"} onClick={() => setPayment("efectivo")}>
                💵 Efectivo
                <span className="block text-xs font-normal opacity-75">
                  {deliveryType === "domicilio" ? "Al recibir" : "Al recoger"}
                </span>
              </Choice>
              {settings.whatsapp && (
                <Choice active={payment === "whatsapp"} onClick={() => setPayment("whatsapp")}>
                  💬 Por WhatsApp
                  <span className="block text-xs font-normal opacity-75">Confirmamos por chat</span>
                </Choice>
              )}
            </div>
            {payment === "efectivo" && deliveryType === "domicilio" && (
              <div className="max-w-xs">
                <label className="label">¿Con cuánto pagas? (para llevarte cambio)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="1"
                  placeholder={String(Math.ceil(total / 100))}
                  value={cashGiven}
                  onChange={(e) => setCashGiven(e.target.value)}
                />
              </div>
            )}
          </section>

          <section className="card space-y-1 text-sm">
            <Row label="Subtotal" value={money(subtotal)} />
            {fee > 0 && <Row label="Envío" value={money(fee)} />}
            <div className="flex justify-between pt-2 text-lg font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
            {belowMin && (
              <p className="text-amber-700">
                Pedido mínimo a domicilio: {money(settings.minDeliveryOrder)}. Agrega {money(settings.minDeliveryOrder - subtotal)} más.
              </p>
            )}
          </section>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={sending || lines.length === 0 || belowMin}
            className={payment === "whatsapp" ? "btn-whatsapp w-full py-3 text-base" : "btn-primary w-full py-3 text-base"}
          >
            {sending
              ? "Enviando…"
              : payment === "stripe"
                ? `Ir a pagar ${money(total)}`
                : payment === "whatsapp"
                  ? "Continuar en WhatsApp"
                  : `Confirmar pedido · ${money(total)}`}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28">
      <nav className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-cafe-50/95 px-4 py-3 backdrop-blur">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
              category === c ? "bg-cafe-800 text-white" : "bg-white text-cafe-800 ring-1 ring-cafe-200"
            }`}
          >
            {c}
          </button>
        ))}
      </nav>

      {grouped.map(([cat, items]) => (
        <section key={cat} className="mt-4">
          <h2 className="mb-3 text-lg font-semibold text-cafe-800">{cat}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => {
              const q = cart[p.id] ?? 0;
              return (
                <article key={p.id} className="card flex gap-3">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-cafe-100 text-3xl">
                      ☕
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <h3 className="font-medium">{p.name}</h3>
                    <p className="line-clamp-2 text-xs text-cafe-600">{p.description}</p>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="font-semibold">{money(p.price)}</span>
                      {p.soldOut ? (
                        <span className="badge bg-cafe-100 text-cafe-600">Agotado</span>
                      ) : !settings.open ? null : q === 0 ? (
                        <button className="btn-primary px-3 py-1" onClick={() => add(p, 1)}>
                          Agregar
                        </button>
                      ) : (
                        <Stepper qty={q} onMinus={() => add(p, -1)} onPlus={() => add(p, 1)} canPlus={q < p.maxQty} />
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {count > 0 && settings.open && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-cafe-200 bg-white/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <button className="flex-1 text-left text-sm" onClick={() => setShowCart((v) => !v)}>
              <span className="font-semibold">{count} producto{count === 1 ? "" : "s"}</span> ·{" "}
              {money(subtotal)} <span className="text-cafe-600 underline">ver</span>
            </button>
            <button className="btn-primary px-6 py-3" onClick={() => setStep("checkout")}>
              Hacer pedido
            </button>
          </div>
          {showCart && (
            <div className="mx-auto mt-3 max-h-64 max-w-5xl space-y-2 overflow-y-auto">
              {lines.map((l) => (
                <div key={l.p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex-1">{l.p.name}</span>
                  <Stepper
                    qty={l.qty}
                    onMinus={() => add(l.p, -1)}
                    onPlus={() => add(l.p, 1)}
                    canPlus={l.qty < l.p.maxQty}
                  />
                  <span className="w-20 text-right">{money(l.p.price * l.qty)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left text-sm font-medium transition ${
        active ? "border-cafe-700 bg-cafe-100 ring-2 ring-cafe-300" : "border-cafe-200 bg-white hover:bg-cafe-50"
      }`}
    >
      {children}
    </button>
  );
}

function Stepper({ qty, onMinus, onPlus, canPlus }: { qty: number; onMinus: () => void; onPlus: () => void; canPlus: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <button className="h-8 w-8 rounded-full bg-cafe-100 font-bold text-cafe-800" onClick={onMinus} aria-label="Quitar uno">
        −
      </button>
      <span className="w-5 text-center font-medium">{qty}</span>
      <button
        className="h-8 w-8 rounded-full bg-cafe-800 font-bold text-white disabled:opacity-40"
        onClick={onPlus}
        disabled={!canPlus}
        aria-label="Agregar uno"
      >
        +
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-cafe-700">{label}</span>
      <span>{value}</span>
    </div>
  );
}
