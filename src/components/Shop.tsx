"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { normalizeCp, quoteDelivery, type DeliveryRules } from "@/lib/delivery";
import { onlineFee, type OnlineFeeRules } from "@/lib/fees";

export type ShopProduct = {
  id: number;
  name: string;
  size: string;
  icon: string;
  /** p.ej. "Solo Vie, Sáb" cuando hoy no se vende; null si está disponible */
  notToday: string | null;
  description: string;
  category: string;
  /** precio en línea (con comisión incluida) */
  price: number;
  /** precio normal de mostrador */
  basePrice: number;
  image_url: string;
  soldOut: boolean;
  maxQty: number;
};

type ShopSettings = {
  open: boolean;
  deliveryEnabled: boolean;
  delivery: DeliveryRules;
  minDeliveryOrder: number;
  whatsapp: boolean;
  stripe: boolean;
  onlineFee: OnlineFeeRules;
};

/** Una línea del pedido: mismo producto con distintas indicaciones = líneas distintas */
type CartLine = { key: string; productId: number; qty: number; note: string };
const CART_KEY = "cafe_cart_v2";

const CATEGORY_ICON: Record<string, string> = {
  "Bebidas Calientes": "☕",
  "Calientes Sin Café": "🍫",
  "Bebidas Frías": "🧊",
  Café: "☕",
  "Sin Café": "🍫",
  "Barra Fría": "🧊",
  "Frappés Especiales": "🥤",
  Malteadas: "🍓",
  Postres: "🥐",
  Snacks: "🥪",
  Combos: "🍱",
  "Snacks Especiales": "🍗",
};
const iconFor = (category: string) => CATEGORY_ICON[category] ?? "☕";
const CUSTOMER_KEY = "cafe_customer_v1";

export default function Shop({ products, settings }: { products: ShopProduct[]; settings: ShopSettings }) {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<"menu" | "checkout">("menu");
  const [category, setCategory] = useState<string | null>(null); // null = vista de categorías
  const [detail, setDetail] = useState<ShopProduct[] | null>(null); // producto abierto (con sus tamaños)
  const [loaded, setLoaded] = useState(false);

  // Datos del cliente
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveryType, setDeliveryType] = useState<"domicilio" | "recoger">(
    settings.deliveryEnabled ? "domicilio" : "recoger",
  );
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
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
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]") as CartLine[];
      setCart(
        (Array.isArray(saved) ? saved : []).filter((l) => {
          const p = products.find((x) => x.id === l.productId);
          return p && !p.soldOut && !p.notToday && l.qty > 0;
        }),
      );
      const cust = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || "{}");
      if (cust.name) setName(cust.name);
      if (cust.phone) setPhone(cust.phone);
      if (cust.address) setAddress(cust.address);
      if (cust.postalCode) setPostalCode(cust.postalCode);
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

  // categoría -> productos agrupados por nombre (cada grupo = sus tamaños)
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, ShopProduct[]>>();
    for (const p of products) {
      if (!m.has(p.category)) m.set(p.category, new Map());
      const byName = m.get(p.category)!;
      if (!byName.has(p.name)) byName.set(p.name, []);
      byName.get(p.name)!.push(p);
    }
    return [...m.entries()].map(([cat, byName]) => ({ category: cat, items: [...byName.values()] }));
  }, [products]);
  const current = groups.find((g) => g.category === category) ?? null;

  // Mantiene visible la pestaña de la categoría activa
  useEffect(() => {
    document
      .querySelector(`[data-tab="${CSS.escape(category ?? "menu")}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [category]);

  const lines = cart
    .map((l) => ({ ...l, p: products.find((x) => x.id === l.productId)! }))
    .filter((l) => l.p && l.qty > 0);
  const qtyOf = (productId: number) => cart.filter((l) => l.productId === productId).reduce((a, l) => a + l.qty, 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
  const byZones = settings.delivery.zones.length > 0;
  const quote = quoteDelivery(settings.delivery, postalCode, subtotal);
  const fee = deliveryType === "domicilio" && quote.ok ? quote.fee : 0;
  const missingForFree =
    deliveryType === "domicilio" && settings.delivery.freeFrom > 0 && subtotal < settings.delivery.freeFrom
      ? settings.delivery.freeFrom - subtotal
      : 0;
  const deliveryBlocked = deliveryType === "domicilio" && !quote.ok;
  // Comisión por pago en línea (si el negocio la traslada al cliente)
  // Los precios en línea ya incluyen el porcentaje; con tarjeta solo se suma lo que falte del cargo fijo
  const baseAmount = lines.reduce((a, l) => a + l.p.basePrice * l.qty, 0) + fee;
  const cardFee = settings.stripe
    ? Math.max(0, baseAmount + onlineFee(baseAmount, settings.onlineFee) - (subtotal + fee))
    : 0;
  const serviceFee = payment === "stripe" ? cardFee : 0;
  const total = subtotal + fee + serviceFee;
  const belowMin = deliveryType === "domicilio" && subtotal < settings.minDeliveryOrder;

  function addToCart(p: ShopProduct, qty: number, note: string) {
    const clean = note.trim().slice(0, 120);
    const key = `${p.id}|${clean}`;
    setCart((c) => {
      const room = p.maxQty - c.filter((l) => l.productId === p.id).reduce((a, l) => a + l.qty, 0);
      const n = Math.min(qty, room);
      if (n <= 0) return c;
      const existing = c.find((l) => l.key === key);
      return existing
        ? c.map((l) => (l.key === key ? { ...l, qty: l.qty + n } : l))
        : [...c, { key, productId: p.id, qty: n, note: clean }];
    });
  }

  function changeLine(key: string, delta: number) {
    setCart((c) =>
      c
        .map((l) => {
          if (l.key !== key) return l;
          const p = products.find((x) => x.id === l.productId);
          const others = c.filter((o) => o.productId === l.productId && o.key !== key).reduce((a, o) => a + o.qty, 0);
          return { ...l, qty: Math.max(0, Math.min(l.qty + delta, (p?.maxQty ?? 99) - others)) };
        })
        .filter((l) => l.qty > 0),
    );
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
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name, phone, address, addressRef, postalCode }));
    } catch {}
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.p.id, qty: l.qty, note: l.note })),
          customerName: name,
          phone,
          deliveryType,
          address,
          addressRef,
          postalCode,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          notes,
          paymentMethod: payment,
          cashGiven: payment === "efectivo" && cashGiven ? Number(cashGiven) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el pedido");
      setCart([]);
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
        <button className="mb-3 flex items-center gap-1 text-sm font-medium text-cafe-700" onClick={() => setStep("menu")}>
          <span aria-hidden>‹</span> Menú
        </button>
        <h2 className="mb-4 text-2xl font-bold">Revisa tu pedido</h2>
        <form onSubmit={submit} className="space-y-5">
          <section className="card divide-y divide-cafe-50 p-0">
            {lines.map((l) => (
              <div key={l.key} className="flex items-center gap-3 p-3">
                <ProductImage p={l.p} size="sm" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{l.p.name}</p>
                  <p className="text-xs text-cafe-600">
                    {[l.p.size, l.note].filter(Boolean).join(" · ") || money(l.p.price)}
                  </p>
                  <p className="font-semibold">{money(l.p.price * l.qty)}</p>
                </div>
                <Stepper
                  qty={l.qty}
                  onMinus={() => changeLine(l.key, -1)}
                  onPlus={() => changeLine(l.key, 1)}
                  canPlus={qtyOf(l.p.id) < l.p.maxQty}
                />
              </div>
            ))}
            {lines.length === 0 && <p className="p-4 text-sm text-cafe-600">Tu pedido está vacío.</p>}
            <button type="button" className="w-full p-3 text-left text-sm font-medium text-cafe-700" onClick={() => setStep("menu")}>
              + Agregar más productos
            </button>
          </section>

          <section className="card space-y-3">
            <h3 className="font-semibold">¿Cómo lo quieres recibir?</h3>
            <div className="grid grid-cols-2 gap-2">
              {settings.deliveryEnabled && (
                <Choice active={deliveryType === "domicilio"} onClick={() => setDeliveryType("domicilio")}>
                  🛵 A domicilio
                  <span className="block text-xs font-normal opacity-75">
                    {byZones ? "Envío según tu código postal" : `Envío ${money(settings.delivery.flatFee)}`}
                  </span>
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
                  <label className="label" htmlFor="cp">
                    Código postal
                  </label>
                  <input
                    id="cp"
                    className="input max-w-40"
                    required={byZones}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    pattern="[0-9]{5}"
                    maxLength={5}
                    placeholder="00000"
                    value={postalCode}
                    onChange={(e) => setPostalCode(normalizeCp(e.target.value))}
                  />
                  {byZones && postalCode.length === 5 && (
                    <p className={`mt-1 text-sm ${quote.ok ? "text-green-700" : "text-red-700"}`} aria-live="polite">
                      {quote.ok
                        ? `✓ ${quote.zone} · ${quote.free ? "¡Envío gratis!" : `Envío ${money(quote.fee)}`}`
                        : "Por ahora no llegamos a ese código postal. Puedes elegir “Paso a recoger”."}
                    </p>
                  )}
                </div>
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
                  <span className="block text-xs font-normal opacity-75">
                    Tarjeta, seguro con Stripe{cardFee > 0 ? ` · + ${money(cardFee)} de comisión` : ""}
                  </span>
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
            {deliveryType === "domicilio" && quote.ok && (
              <Row
                label={quote.zone ? `Envío (${quote.zone})` : "Envío"}
                value={quote.free ? "Gratis" : money(fee)}
              />
            )}
            {serviceFee > 0 && <Row label="Comisión por pago en línea" value={money(serviceFee)} />}
            <div className="flex justify-between pt-2 text-lg font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
            {missingForFree > 0 && !belowMin && (
              <p className="text-cafe-700">💡 Agrega {money(missingForFree)} más y tu envío es gratis.</p>
            )}
            {belowMin && (
              <p className="text-amber-700">
                Pedido mínimo a domicilio: {money(settings.minDeliveryOrder)}. Agrega {money(settings.minDeliveryOrder - subtotal)} más.
              </p>
            )}
          </section>

          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={sending || lines.length === 0 || belowMin || deliveryBlocked}
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
    <main className="mx-auto w-full max-w-5xl flex-1 pb-32">
      {/* Navegación de categorías, siempre visible */}
      <nav className="sticky top-0 z-10 border-b border-cafe-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-5 overflow-x-auto px-4">
          {[{ category: null as string | null }, ...groups].map((g) => {
            const active = category === g.category;
            return (
              <button
                key={g.category ?? "menu"}
                data-tab={g.category ?? "menu"}
                onClick={() => {
                  setCategory(g.category);
                  window.scrollTo({ top: 0 });
                }}
                className={`shrink-0 border-b-2 py-3 text-sm font-semibold whitespace-nowrap transition ${
                  active ? "border-cafe-800 text-cafe-900" : "border-transparent text-cafe-500"
                }`}
              >
                {g.category ?? "Menú"}
              </button>
            );
          })}
        </div>
      </nav>

      {!current ? (
        /* Vista principal: categorías en círculos */
        <section className="px-4 pt-6">
          <h2 className="mb-1 text-2xl font-bold">Menú</h2>
          <p className="mb-6 text-sm text-cafe-600">¿Qué se te antoja hoy?</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
            {groups.map((g) => (
              <button
                key={g.category}
                onClick={() => {
                  setCategory(g.category);
                  window.scrollTo({ top: 0 });
                }}
                className="group flex flex-col items-center gap-2 text-center"
              >
                <span className="flex aspect-square w-full max-w-36 items-center justify-center rounded-full bg-cafe-100 text-5xl shadow-inner transition group-hover:scale-105 group-active:scale-95 sm:text-6xl">
                  {iconFor(g.category)}
                </span>
                <span className="text-sm font-semibold">{g.category}</span>
                <span className="-mt-2 text-xs text-cafe-500">{g.items.length} productos</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        /* Vista de categoría: productos en cuadrícula */
        <section className="px-4 pt-4">
          <button className="mb-2 flex items-center gap-1 text-sm font-medium text-cafe-700" onClick={() => setCategory(null)}>
            <span aria-hidden>‹</span> Menú
          </button>
          <h2 className="mb-5 text-2xl font-bold">{current.category}</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
            {current.items.map((variants) => {
              const first = variants[0];
              const from = Math.min(...variants.map((v) => v.price));
              const inCart = variants.reduce((a, v) => a + qtyOf(v.id), 0);
              const unavailable = variants.every((v) => v.soldOut) ? "Agotado" : first.notToday;
              return (
                <button
                  key={first.id}
                  onClick={() => setDetail(variants)}
                  className="group relative flex flex-col items-center text-center"
                >
                  <ProductImage p={first} size="lg" dim={Boolean(unavailable)} />
                  {inCart > 0 && (
                    <span className="absolute top-1 right-[12%] flex h-7 min-w-7 items-center justify-center rounded-full bg-cafe-800 px-1.5 text-xs font-bold text-white ring-2 ring-white">
                      {inCart}
                    </span>
                  )}
                  <span className="mt-3 text-sm leading-tight font-semibold">{first.name}</span>
                  {first.size && (
                    <span className="mt-0.5 text-[11px] text-cafe-500">
                      {variants.map((v) => v.size.split(" ").pop()).join(" · ")}
                    </span>
                  )}
                  <span className="mt-1 text-xs text-cafe-600">
                    {unavailable ? (
                      <span className="font-medium text-amber-700">{unavailable}</span>
                    ) : (
                      <>
                        {variants.length > 1 ? "Desde " : ""}
                        {money(from)}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {detail && (
        <ProductSheet
          variants={detail}
          open={settings.open}
          qtyOf={qtyOf}
          onClose={() => setDetail(null)}
          onAdd={(p, qty, note) => {
            addToCart(p, qty, note);
            setDetail(null);
          }}
        />
      )}

      {count > 0 && settings.open && !detail && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => {
              setStep("checkout");
              window.scrollTo({ top: 0 });
            }}
            className="mx-auto flex w-full max-w-md items-center justify-between rounded-full bg-cafe-800 py-3 pr-5 pl-3 text-white shadow-xl transition active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                🛍️
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-cafe-900">
                  {count}
                </span>
              </span>
              <span className="font-semibold">Ver pedido</span>
            </span>
            <span className="font-semibold tabular-nums">{money(subtotal)}</span>
          </button>
        </div>
      )}
    </main>
  );
}

/** Imagen redonda del producto (o ícono de su categoría). */
function ProductImage({ p, size, dim }: { p: ShopProduct; size: "sm" | "lg" | "xl"; dim?: boolean }) {
  const cls = {
    sm: "h-14 w-14 text-2xl",
    lg: "aspect-square w-full max-w-40 text-5xl sm:text-6xl",
    xl: "h-44 w-44 text-7xl sm:h-52 sm:w-52",
  }[size];
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-cafe-100 transition ${cls} ${
        size === "lg" ? "group-hover:scale-105 group-active:scale-95" : ""
      } ${dim ? "opacity-50 grayscale" : ""}`}
    >
      {p.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{p.icon || iconFor(p.category)}</span>
      )}
    </span>
  );
}

/** Tamaño relativo del vaso según las onzas (8oz chico, 12oz mediano, 16oz grande). */
function cupScale(size: string) {
  const oz = Number(/(\d+)\s*oz/i.exec(size)?.[1] ?? 12);
  return oz <= 8 ? 0 : oz <= 12 ? 1 : 2;
}

/** Vaso para el selector de tamaño: más grande según el tamaño. */
function CupIcon({ scale }: { scale: number }) {
  const h = 22 + scale * 8;
  return (
    <svg width={h * 0.8} height={h} viewBox="0 0 24 30" fill="none" aria-hidden>
      <path d="M4 7h16l-2 21H6L4 7Z" fill="currentColor" opacity=".18" />
      <path d="M4 7h16l-2 21H6L4 7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3 4h18v3H3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Ficha del producto (como en la app de Starbucks): tamaño, cantidad e indicaciones. */
function ProductSheet({
  variants,
  open,
  qtyOf,
  onClose,
  onAdd,
}: {
  variants: ShopProduct[];
  open: boolean;
  qtyOf: (id: number) => number;
  onClose: () => void;
  onAdd: (p: ShopProduct, qty: number, note: string) => void;
}) {
  const firstAvailable = variants.find((v) => !v.soldOut) ?? variants[0];
  const [selectedId, setSelectedId] = useState(firstAvailable.id);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const p = variants.find((v) => v.id === selectedId) ?? variants[0];
  const room = p.maxQty - qtyOf(p.id);
  const blocked = !open ? "Por ahora no estamos recibiendo pedidos" : p.notToday ?? (p.soldOut || room <= 0 ? "Agotado" : null);
  const wantsFlavor = /sabor/i.test(p.name + " " + p.description);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.name}
        className="flex max-h-[95dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto">
          {/* Encabezado con imagen */}
          <div className="relative flex flex-col items-center bg-cafe-900 px-6 pt-10 pb-6 text-white">
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl"
            >
              ×
            </button>
            <ProductImage p={p} size="xl" />
            <h3 className="mt-5 text-center text-2xl font-bold">{p.name}</h3>
            <p className="mt-1 text-lg font-semibold text-cafe-200">{money(p.price)}</p>
          </div>

          <div className="space-y-6 p-5">
            {p.description && <p className="text-sm text-cafe-700">{p.description}</p>}

            {(variants.length > 1 || p.size) && (
              <div>
                <h4 className="mb-3 text-sm font-bold tracking-wide text-cafe-800 uppercase">Tamaño</h4>
                <div className="flex justify-center gap-3" role="radiogroup" aria-label="Tamaño">
                  {variants.map((v, i) => {
                    const sel = v.id === p.id;
                    const [code, ...rest] = v.size.split(" ");
                    return (
                      <button
                        key={v.id}
                        role="radio"
                        aria-checked={sel}
                        disabled={v.soldOut}
                        onClick={() => setSelectedId(v.id)}
                        className={`flex w-24 flex-col items-center justify-end gap-1 rounded-2xl border-2 px-2 pt-3 pb-2 transition disabled:opacity-40 ${
                          sel ? "border-cafe-800 bg-cafe-50 text-cafe-900" : "border-cafe-100 text-cafe-500"
                        }`}
                      >
                        <CupIcon scale={variants.length === 1 ? cupScale(v.size) : (i / (variants.length - 1)) * 2} />
                        <span className="text-sm font-bold">{rest.length ? code : v.size}</span>
                        {rest.length > 0 && <span className="-mt-1 text-[11px]">{rest.join(" ")}</span>}
                        <span className="text-xs font-semibold">{money(v.price)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="item-note" className="mb-2 block text-sm font-bold tracking-wide text-cafe-800 uppercase">
                {wantsFlavor ? "Sabor e indicaciones" : "Indicaciones (opcional)"}
              </label>
              <input
                id="item-note"
                className="input"
                maxLength={120}
                placeholder={wantsFlavor ? "Ej. vainilla, caramelo, cajeta…" : "Ej. leche deslactosada, sin azúcar…"}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Pie fijo: cantidad + agregar */}
        <div className="flex items-center gap-3 border-t border-cafe-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Stepper
            qty={qty}
            onMinus={() => setQty((q) => Math.max(1, q - 1))}
            onPlus={() => setQty((q) => Math.min(q + 1, Math.max(room, 1)))}
            canPlus={qty < room}
          />
          <button
            className="btn-primary flex-1 rounded-full py-3 text-base"
            disabled={Boolean(blocked) || (wantsFlavor && !note.trim())}
            onClick={() => onAdd(p, qty, note)}
          >
            {blocked ?? (wantsFlavor && !note.trim() ? "Escribe el sabor" : `Agregar · ${money(p.price * qty)}`)}
          </button>
        </div>
      </div>
    </div>
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
