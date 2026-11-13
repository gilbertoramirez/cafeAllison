"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { feeForDistance, normalizeCp, tariffText, type DeliveryRules } from "@/lib/delivery";
import { cardPricing, type OnlineFeeRules } from "@/lib/fees";
import { CART_KEY, rememberOrder } from "@/lib/myOrders";
import { normalizePhone, pickFreeLine, type LoyaltySettings, type LoyaltyStatus } from "@/lib/loyaltyRules";
import LoyaltyCard from "./LoyaltyCard";
import type { UpsellData } from "@/lib/upsell";
import { iconFor } from "@/lib/categoryIcons";
import { fuzzyFilter, normalize } from "@/lib/fuzzy";
import { hoursText, isOpenNow, nextOpening, slotDays, type ScheduleRules } from "@/lib/schedule";

export type ShopProduct = {
  id: number;
  name: string;
  size: string;
  icon: string;
  /** p.ej. "Solo Vie, Sáb" cuando hoy no se vende; null si está disponible */
  notToday: string | null;
  description: string;
  category: string;
  /** precio normal (mostrador): se cobra en efectivo o para recoger */
  price: number;
  /** precio que se muestra en el menú (con la comisión del pago en línea incluida) */
  menuPrice: number;
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
  loyalty: LoyaltySettings;
  schedule: ScheduleRules;
};

/** Una línea del pedido: mismo producto con distintas indicaciones = líneas distintas */
type CartLine = { key: string; productId: number; qty: number; note: string };


const CUSTOMER_KEY = "cafe_customer_v1";

const DRINK_CATEGORIES = new Set([
  "Bebidas Calientes",
  "Calientes Sin Café",
  "Bebidas Frías",
  "Frappés Especiales",
  "Malteadas",
  "Café",
  "Sin Café",
  "Barra Fría",
]);
const isDrinkCategory = (c: string) => DRINK_CATEGORIES.has(c);

export default function Shop({
  products,
  settings,
  upsell,
  categoryImages = {},
}: {
  products: ShopProduct[];
  settings: ShopSettings;
  upsell?: UpsellData;
  /** foto propia de cada categoría (si no hay, se usa la de uno de sus productos) */
  categoryImages?: Record<string, string>;
}) {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<"menu" | "checkout">("menu");
  const [category, setCategory] = useState<string | null>(null); // null = vista de categorías
  const [detail, setDetail] = useState<ShopProduct[] | null>(null); // producto abierto (con sus tamaños)
  const [justAdded, setJustAdded] = useState<string | null>(null); // para sugerir "¿Le agregas…?"
  // ¿Para cuándo? (pedidos programados). La hora actual se toma en el navegador y se actualiza cada minuto.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now()); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [when, setWhen] = useState<"asap" | "later" | null>(null);
  const [slot, setSlot] = useState("");
  const [slotDay, setSlotDay] = useState("");
  const schedOn = settings.schedule.enabled;
  const openNow = now === null || !schedOn || isOpenNow(settings.schedule, new Date(now));
  const days = useMemo(() => (now === null ? [] : slotDays(settings.schedule, new Date(now))), [now, settings.schedule]);
  const mode = when ?? (openNow ? "asap" : "later");
  const opensAt = now === null || openNow ? null : nextOpening(settings.schedule, new Date(now));
  const activeDay = days.find((d) => d.ymd === slotDay) ?? days[0];
  const chosenSlot = activeDay?.slots.some((s) => s.iso === slot) ? slot : (activeDay?.slots[0]?.iso ?? "");
  const scheduleBlocked = schedOn && mode === "later" && !chosenSlot;
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
  // Envío por distancia: km desde la cafetería según la dirección (o la ubicación compartida)
  const [dist, setDist] = useState<
    | { status: "idle" | "loading" }
    | { status: "ok"; km: number; formatted: string; approx: boolean; minutes: number | null }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const distKey =
    deliveryType !== "domicilio" || !settings.delivery.maps
      ? ""
      : coords
        ? `gps:${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`
        : address.trim().length >= 6 && postalCode.length === 5
          ? `dir:${address.trim()}|${postalCode}`
          : "";
  useEffect(() => {
    if (!distKey) return setDist({ status: "idle" }); // eslint-disable-line react-hooks/set-state-in-effect
    setDist({ status: "loading" });
    let alive = true;
    const t = setTimeout(
      async () => {
        try {
          const res = await fetch("/api/envio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, postalCode, lat: coords?.lat, lng: coords?.lng }),
          });
          const d = await res.json();
          if (!alive) return;
          setDist(
            d.ok && typeof d.km === "number"
              ? { status: "ok", km: d.km, formatted: d.formatted ?? "", approx: Boolean(d.approx), minutes: d.minutes ?? null }
              : { status: "error", message: d.message ?? "No pudimos calcular el envío." },
          );
        } catch {
          if (alive) setDist({ status: "error", message: "No pudimos calcular el envío. Revisa tu conexión." });
        }
      },
      coords ? 0 : 1200,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [distKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notes, setNotes] = useState("");
  const [payment, setPayment] = useState<"stripe" | "efectivo" | "whatsapp">(
    settings.stripe ? "stripe" : "efectivo",
  );
  const [cashGiven, setCashGiven] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [locating, setLocating] = useState(false);
  // Lealtad: sellos del teléfono y canje de bebida gratis con código
  const [loyalty, setLoyalty] = useState<LoyaltyStatus | null>(null);
  const [onlineRedeem, setOnlineRedeem] = useState(false);
  const [redeem, setRedeem] = useState<{ stage: "off" | "code" | "on"; code: string; info: string }>({
    stage: "off",
    code: "",
    info: "",
  });
  const loyaltyPhone = normalizePhone(phone);
  useEffect(() => {
    if (!settings.loyalty.enabled || !loyaltyPhone) return setLoyalty(null); // eslint-disable-line react-hooks/set-state-in-effect
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/lealtad?phone=${loyaltyPhone}`, { cache: "no-store" });
        const data = await res.json();
        if (alive) {
          setLoyalty(data.status);
          setOnlineRedeem(data.onlineRedeem);
        }
      } catch {}
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [loyaltyPhone, settings.loyalty.enabled]);
  useEffect(() => setRedeem({ stage: "off", code: "", info: "" }), [loyaltyPhone]); // eslint-disable-line react-hooks/set-state-in-effect

  async function sendCode() {
    setRedeem((r) => ({ ...r, info: "Enviando código…" }));
    try {
      const res = await fetch("/api/lealtad/codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loyaltyPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRedeem({
        stage: "code",
        code: "",
        info: data.devCode
          ? `Modo de prueba: tu código es ${data.devCode}`
          : "Te enviamos un código por mensaje. Escríbelo aquí:",
      });
    } catch (e) {
      setRedeem({ stage: "off", code: "", info: e instanceof Error ? e.message : "No se pudo enviar el código" });
    }
  }

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
      // Regreso desde "Cambiar forma de pago": abrir directo la revisión del pedido
      if (new URLSearchParams(window.location.search).get("pedido") === "1") setStep("checkout");
    } catch {}
    setLoaded(true);
  }, [products]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Al regresar con "atrás" desde Stripe, la página puede venir de la caché del navegador
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setSending(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

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

  // Búsqueda en todo el menú (tolera acentos y errores de dedo)
  const [query, setQuery] = useState("");
  const searching = normalize(query).length > 0;
  const results = useMemo(
    () =>
      searching
        ? fuzzyFilter(
            groups.flatMap((g) => g.items),
            query,
            (v) => [
              { text: v[0].name, weight: 1 },
              { text: v[0].category, weight: 0.6 },
              { text: v.map((x) => x.size).join(" "), weight: 0.5 },
              { text: v[0].description, weight: 0.4 },
            ],
          )
        : [],
    [groups, query, searching],
  );

  // "¿Le agregas…?": lo que se compra junto con lo del carrito y, si no hay datos, lo más vendido
  // del tipo complementario (con bebida → algo de comer; con comida → una bebida)
  const byName = useMemo(() => {
    const m = new Map<string, ShopProduct[]>();
    for (const p of products) {
      if (!m.has(p.name)) m.set(p.name, []);
      m.get(p.name)!.push(p);
    }
    return m;
  }, [products]);
  function suggestionsFor(names: string[], exclude: Set<string>, max: number): ShopProduct[][] {
    const out: string[] = [];
    const ok = (n: string) => {
      const v = byName.get(n);
      return v && !exclude.has(n) && !out.includes(n) && v.some((p) => !p.soldOut && !p.notToday);
    };
    for (const n of names) for (const c of upsell?.companions[n] ?? []) if (out.length < max && ok(c)) out.push(c);
    const cats = names.map((n) => byName.get(n)?.[0]?.category ?? "").filter(Boolean);
    const hasDrink = cats.some(isDrinkCategory);
    // Lo que le falta: si ya lleva bebida, algo de comer; si solo lleva comida, una bebida
    const wantFood = hasDrink;
    const wantDrink = !hasDrink;
    const fits = (n: string) => {
      const c = byName.get(n)?.[0]?.category ?? "";
      return (wantFood && !isDrinkCategory(c)) || (wantDrink && isDrinkCategory(c));
    };
    for (const n of [...(upsell?.popular ?? []), ...byName.keys()]) if (out.length < max && fits(n) && ok(n)) out.push(n);
    return out.map((n) => byName.get(n)!.filter((p) => !p.soldOut && !p.notToday));
  }
  function addSuggestion(variants: ShopProduct[]) {
    if (variants.length === 1) {
      addToCart(variants[0], 1, "");
      setJustAdded(null);
    } else setDetail(variants);
  }

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
  const subtotal = lines.reduce((a, l) => a + l.p.price * l.qty, 0); // a precio normal (envío y mínimo)
  const menuSubtotal = lines.reduce((a, l) => a + l.p.menuPrice * l.qty, 0);
  // Bebida gratis: una unidad de la bebida elegible más cara (mismo criterio que el servidor)
  const freeIdx =
    redeem.stage === "on"
      ? pickFreeLine(lines.map((l) => ({ category: l.p.category, size: l.p.size, price: l.p.price })))
      : -1;
  const freeBase = freeIdx >= 0 ? lines[freeIdx].p.price : 0;
  const payableSubtotal = subtotal - freeBase; // a precio normal, sin la bebida gratis
  const byDistance = settings.delivery.maps;
  const quote = feeForDistance(settings.delivery, byDistance && dist.status === "ok" ? dist.km : null, payableSubtotal);
  const fee = deliveryType === "domicilio" && quote.ok ? quote.fee : 0;
  const missingForFree =
    deliveryType === "domicilio" && settings.delivery.freeFrom > 0 && payableSubtotal < settings.delivery.freeFrom
      ? settings.delivery.freeFrom - payableSubtotal
      : 0;
  const deliveryBlocked = deliveryType === "domicilio" && byDistance && dist.status !== "ok";
  // La tienda siempre cobra los precios del menú en línea (mismo cálculo que el servidor);
  // con tarjeta se suma además el cargo fijo de Stripe en un renglón aparte.
  // Líneas para calcular (la unidad gratis va aparte a $0, igual que en el servidor)
  const calc = lines.flatMap((l, i) =>
    i === freeIdx
      ? [...(l.qty > 1 ? [{ i, qty: l.qty - 1, free: false }] : []), { i, qty: 1, free: true }]
      : [{ i, qty: l.qty, free: false }],
  );
  const priced =
    settings.stripe && payment === "stripe"
      ? cardPricing(
          calc.map((c) => ({ price: c.free ? 0 : lines[c.i].p.price, qty: c.qty })),
          fee,
          settings.onlineFee,
        )
      : { prices: calc.map((c) => (c.free ? 0 : lines[c.i].p.menuPrice)), delivery: fee, cardFee: 0 };
  const unitPrices = lines.map((l, i) => {
    const k = calc.findIndex((c) => c.i === i && !c.free);
    return k >= 0 ? priced.prices[k] : l.p.menuPrice;
  });
  const freeValue = freeIdx >= 0 ? lines[freeIdx].p.menuPrice : 0;
  const deliveryCharged = priced.delivery;
  const itemsTotal = calc.reduce((a, c, k) => a + priced.prices[k] * c.qty, 0);
  const cardFee = priced.cardFee;
  const total = itemsTotal + deliveryCharged + cardFee;
  const belowMin = deliveryType === "domicilio" && payableSubtotal < settings.minDeliveryOrder;

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
    // Si hay un intento de pago con tarjeta sin terminar, se cancela antes de crear el nuevo pedido
    try {
      const prevToken = localStorage.getItem("cafe_pending_order");
      if (prevToken) {
        localStorage.removeItem("cafe_pending_order");
        await fetch(`/api/orders/${prevToken}/cancelar`, { method: "POST" }).catch(() => {});
      }
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
          scheduledFor: schedOn && mode === "later" ? chosenSlot : null,
          useReward: redeem.stage === "on",
          loyaltyCode: redeem.stage === "on" ? redeem.code : undefined,
          cashGiven: payment === "efectivo" && cashGiven ? Number(cashGiven) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (/código/i.test(data.error ?? "")) setRedeem({ stage: "off", code: "", info: "" });
        throw new Error(data.error || "No se pudo enviar el pedido");
      }
      rememberOrder(data.token); // para verlo en "Mis pedidos"
      if (data.checkoutUrl) {
        // El carrito se conserva hasta confirmar el pago (por si el cliente se regresa)
        try {
          localStorage.setItem("cafe_pending_order", data.token);
        } catch {}
        window.location.assign(data.checkoutUrl);
        return;
      }
      setCart([]);
      router.push(`/pedido/${data.token}${payment === "whatsapp" ? "?wa=1" : ""}`);
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
            {lines.map((l, i) => (
              <div key={l.key} className="flex items-center gap-3 p-3">
                <ProductImage p={l.p} size="sm" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{l.p.name}</p>
                  <p className="text-xs text-cafe-600">
                    {[l.p.size, l.note].filter(Boolean).join(" · ") || money(unitPrices[i])}
                  </p>
                  <p className="font-semibold">{money(unitPrices[i] * l.qty)}</p>
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

          {lines.length > 0 &&
            (() => {
              const names = [...lines].reverse().map((l) => l.p.name);
              const sugg = suggestionsFor(names, new Set(names), 3);
              if (!sugg.length) return null;
              return (
                <section className="card space-y-2">
                  <h3 className="font-semibold">¿Le agregas algo más?</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {sugg.map((v) => (
                      <SuggestionCard key={v[0].name} variants={v} onAdd={() => addSuggestion(v)} vertical />
                    ))}
                  </div>
                </section>
              );
            })()}

          <section className="card space-y-3">
            <h3 className="font-semibold">¿Cómo lo quieres recibir?</h3>
            <div className="grid grid-cols-2 gap-2">
              {settings.deliveryEnabled && (
                <Choice active={deliveryType === "domicilio"} onClick={() => setDeliveryType("domicilio")}>
                  🛵 A domicilio
                  <span className="block text-xs font-normal opacity-75">
                    {byDistance ? "Envío según la distancia" : `Envío ${money(settings.delivery.baseFee)}`}
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
                  pattern="[0-9 +()\-]{10,}"
                  title="Al menos 10 dígitos"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            {loyalty && (
              <div className="space-y-2">
                <LoyaltyCard status={loyalty} compact />
                {loyalty.rewards.length > 0 &&
                  (!onlineRedeem ? (
                    <p className="text-sm text-cafe-700">Tu bebida gratis se canjea en la caja de la cafetería.</p>
                  ) : redeem.stage === "on" ? (
                    <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800">
                      🎁 Bebida gratis aplicada
                      {freeIdx < 0 && " — agrega una bebida de hasta 12oz a tu pedido para usarla"}.{" "}
                      <button type="button" className="underline" onClick={() => setRedeem({ stage: "off", code: "", info: "" })}>
                        Quitar
                      </button>
                    </p>
                  ) : redeem.stage === "code" ? (
                    <div className="space-y-2 rounded-lg bg-cafe-50 p-3 text-sm">
                      <p>{redeem.info}</p>
                      <div className="flex gap-2">
                        <input
                          className="input w-36 text-center tracking-widest"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="000000"
                          value={redeem.code}
                          onChange={(e) => setRedeem({ ...redeem, code: e.target.value.replace(/\D/g, "") })}
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={redeem.code.length !== 6}
                          onClick={() => setRedeem({ ...redeem, stage: "on" })}
                        >
                          Aplicar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <button type="button" className="btn-secondary w-full" onClick={sendCode}>
                        🎁 Usar mi bebida gratis en este pedido
                      </button>
                      {redeem.info && <p className="text-sm text-cafe-700">{redeem.info}</p>}
                    </div>
                  ))}
              </div>
            )}
            {deliveryType === "domicilio" && (
              <>
                <div>
                  <label className="label" htmlFor="addr">
                    Dirección de entrega
                  </label>
                  <input
                    id="addr"
                    className="input"
                    required
                    autoComplete="street-address"
                    placeholder="Calle, número, colonia"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="cp">
                    Código postal
                  </label>
                  <input
                    id="cp"
                    className="input max-w-40"
                    required={byDistance}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    pattern="[0-9]{5}"
                    maxLength={5}
                    placeholder="00000"
                    value={postalCode}
                    onChange={(e) => setPostalCode(normalizeCp(e.target.value))}
                  />
                </div>
                {byDistance && (
                  <div aria-live="polite" className="text-sm">
                    {dist.status === "idle" && !coords && (
                      <p className="text-cafe-600">
                        Escribe tu dirección y código postal (o comparte tu ubicación) para calcular el envío.
                        <span className="block text-xs">Tarifa: {tariffText(settings.delivery, money)}.</span>
                      </p>
                    )}
                    {dist.status === "loading" && <p className="text-cafe-600">📍 Calculando envío…</p>}
                    {dist.status === "ok" && (
                      <div className="rounded-lg bg-green-50 p-2 text-green-800">
                        <p>
                          📍 {dist.formatted} · <b>{dist.km} km</b>
                          {dist.minutes ? ` · ~${dist.minutes} min` : ""}
                        </p>
                        <p className="font-semibold">
                          {quote.ok && (quote.free ? "¡Envío gratis!" : `Envío ${money(quote.fee)}`)}
                        </p>
                        {dist.approx && !coords && (
                          <p className="mt-1 text-amber-700">
                            Solo encontramos la zona aproximada. Si no es tu dirección, corrígela o toca “Compartir mi ubicación”.
                          </p>
                        )}
                      </div>
                    )}
                    {dist.status === "error" && <p className="rounded-lg bg-red-50 p-2 text-red-700">{dist.message}</p>}
                  </div>
                )}
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

          {schedOn && (
            <section className="card space-y-3">
              <h3 className="font-semibold">¿Para cuándo?</h3>
              <div className="grid grid-cols-2 gap-2">
                <Choice active={mode === "asap"} onClick={() => openNow && setWhen("asap")}>
                  ⚡ Lo antes posible
                  <span className="block text-xs font-normal opacity-75">
                    {openNow ? `Listo en ~${settings.schedule.prepMinutes} min` : opensAt ? `Cerrado · abrimos ${opensAt}` : "Ahora estamos cerrados"}
                  </span>
                </Choice>
                <Choice active={mode === "later"} onClick={() => setWhen("later")}>
                  ⏰ Programar
                  <span className="block text-xs font-normal opacity-75">Elige día y hora</span>
                </Choice>
              </div>
              {mode === "later" &&
                (days.length === 0 ? (
                  <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
                    No hay horarios disponibles para programar por ahora.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {days.map((d) => (
                        <button
                          key={d.ymd}
                          type="button"
                          onClick={() => setSlotDay(d.ymd)}
                          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
                            activeDay?.ymd === d.ymd ? "bg-cafe-800 text-white" : "bg-cafe-50 ring-1 ring-cafe-200"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <label className="label" htmlFor="slot">
                      {deliveryType === "domicilio" ? "Hora de entrega" : "Hora para recoger"}
                    </label>
                    <select id="slot" className="input" value={chosenSlot} onChange={(e) => setSlot(e.target.value)}>
                      {activeDay?.slots.map((s) => (
                        <option key={s.iso} value={s.iso}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {!openNow && (
                      <p className="text-xs text-cafe-600">
                        Horario: {hoursText(settings.schedule)}. Tu pedido queda apartado para la hora que elijas.
                      </p>
                    )}
                  </div>
                ))}
            </section>
          )}

          <section className="card space-y-3">
            <h3 className="font-semibold">Forma de pago</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {settings.stripe && (
                <Choice active={payment === "stripe"} onClick={() => setPayment("stripe")}>
                  💳 Pagar en línea
                  <span className="block text-xs font-normal opacity-75">
                    Tarjeta, seguro con Stripe
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
            <Row label="Subtotal" value={money(itemsTotal + freeValue)} />
            {freeIdx >= 0 && <Row label={`🎁 Bebida gratis (${lines[freeIdx].p.name})`} value={`−${money(freeValue)}`} />}
            {deliveryType === "domicilio" && quote.ok && !deliveryBlocked && (
              <Row
                label={byDistance && dist.status === "ok" ? `Envío (${dist.km} km)` : "Envío"}
                value={deliveryCharged > 0 ? money(deliveryCharged) : "Gratis"}
              />
            )}
            {cardFee > 0 && <Row label="Cargo por pago con tarjeta" value={money(cardFee)} />}
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
            disabled={sending || lines.length === 0 || belowMin || deliveryBlocked || scheduleBlocked}
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
      </main>
    );
  }

  function productCard(variants: ShopProduct[]) {
    const first = variants[0];
    const from = Math.min(...variants.map((v) => v.menuPrice));
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
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 pb-24">
      {/* Búsqueda y navegación de categorías, siempre visibles */}
      <nav className="sticky top-0 z-10 border-b border-cafe-100 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 pt-3">
          <label className="relative block">
            <span className="sr-only">Buscar en el menú</span>
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-cafe-400" aria-hidden>
              🔍
            </span>
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              className="input rounded-full pr-10 pl-10"
              placeholder="Busca un café, frappé, sándwich…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                window.scrollTo({ top: 0 });
              }}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Borrar búsqueda"
                className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-cafe-100 text-cafe-700"
              >
                ×
              </button>
            )}
          </label>
        </div>
        <div className="mx-auto flex max-w-5xl gap-5 overflow-x-auto px-4">
          {[{ category: null as string | null }, ...groups].map((g) => {
            const active = !searching && category === g.category;
            return (
              <button
                key={g.category ?? "menu"}
                data-tab={g.category ?? "menu"}
                onClick={() => {
                  setCategory(g.category);
                  setQuery("");
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

      {searching ? (
        /* Resultados de la búsqueda */
        <section className="px-4 pt-4">
          <p className="mb-4 text-sm text-cafe-600">
            {results.length
              ? `${results.length} resultado${results.length === 1 ? "" : "s"} para “${query.trim()}”`
              : `No encontramos “${query.trim()}”.`}
          </p>
          {results.length ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((variants) => productCard(variants))}
            </div>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-4xl">🔎</p>
              <p className="text-sm text-cafe-700">Prueba con otra palabra o revisa las categorías:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {groups.map((g) => (
                  <button
                    key={g.category}
                    className="rounded-full bg-cafe-50 px-3 py-1 text-sm ring-1 ring-cafe-200"
                    onClick={() => {
                      setQuery("");
                      setCategory(g.category);
                    }}
                  >
                    {g.category}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : !current ? (
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
                <span className="flex aspect-square w-full max-w-36 items-center justify-center overflow-hidden rounded-full bg-cafe-100 text-5xl shadow-inner transition group-hover:scale-105 group-active:scale-95 sm:text-6xl">
                  {(() => {
                    const photo = categoryImages[g.category] || g.items.flat().find((p) => p.image_url)?.image_url;
                    // eslint-disable-next-line @next/next/no-img-element
                    return photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : iconFor(g.category);
                  })()}
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
            {current.items.map((variants) => productCard(variants))}
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
            setJustAdded(p.name);
          }}
        />
      )}

      {/* ¿Le agregas…? justo después de agregar algo */}
      {justAdded && settings.open && !detail && (() => {
        const inCart = new Set(lines.map((l) => l.p.name));
        const sugg = suggestionsFor([justAdded], inCart, 2);
        if (!sugg.length) return null;
        return (
          <div className="fixed inset-x-0 bottom-[calc(8.25rem+env(safe-area-inset-bottom))] z-20 px-3" role="status">
            <div className="mx-auto max-w-md rounded-2xl bg-white p-3 shadow-xl ring-1 ring-cafe-100">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">✓ Agregado. ¿Le agregas…?</p>
                <button className="px-1 text-lg leading-none text-cafe-500" aria-label="Cerrar" onClick={() => setJustAdded(null)}>
                  ×
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {sugg.map((v) => (
                  <SuggestionCard key={v[0].name} variants={v} onAdd={() => addSuggestion(v)} />
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {count > 0 && settings.open && !detail && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 p-3">
          <button
            onClick={() => {
              setStep("checkout");
              setJustAdded(null);
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
            <span className="font-semibold tabular-nums">{money(menuSubtotal)}</span>
          </button>
        </div>
      )}
    </main>
  );
}

/** Producto sugerido ("¿Le agregas…?") con botón para agregarlo. */
function SuggestionCard({ variants, onAdd, vertical }: { variants: ShopProduct[]; onAdd: () => void; vertical?: boolean }) {
  const p = variants[0];
  const from = Math.min(...variants.map((v) => v.menuPrice));
  return (
    <button
      type="button"
      onClick={onAdd}
      className={`flex items-center gap-2 rounded-xl bg-cafe-50 p-2 text-left ring-1 ring-cafe-100 transition active:scale-[0.97] ${
        vertical ? "flex-col text-center" : ""
      }`}
    >
      <ProductImage p={p} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-xs leading-tight font-semibold">{p.name}</span>
        <span className="block text-xs text-cafe-600">
          {variants.length > 1 ? "Desde " : ""}
          {money(from)}
        </span>
      </span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cafe-800 text-sm font-bold text-white" aria-hidden>
        +
      </span>
    </button>
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
            <p className="mt-1 text-lg font-semibold text-cafe-200">{money(p.menuPrice)}</p>
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
                        <span className="text-xs font-semibold">{money(v.menuPrice)}</span>
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
            {blocked ?? (wantsFlavor && !note.trim() ? "Escribe el sabor" : `Agregar · ${money(p.menuPrice * qty)}`)}
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
