"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  checkPassword,
  endSession,
  passwordConfigured,
  requireAdmin,
  startSession,
} from "@/lib/auth";
import { get, run, transaction } from "@/lib/db";
import { addDays, addMonths, localDate, toCents } from "@/lib/format";
import {
  createOrder,
  deleteCancelledOrder,
  markOrderPaid,
  OrderError,
  setOrderStatus,
} from "@/lib/orders";
import { getSettings, setSetting } from "@/lib/settings";
import { sendNtfy } from "@/lib/notify";
import { isShortMapsLink, parseCoords, resolveShortMapsLink } from "@/lib/coords";
import { markDelivered, markOnTheWay, planRoute, type RouteResult } from "@/lib/deliveryRoute";
import { hashPin, validPin } from "@/lib/drivers";
import { addMovement, CashError, closeSession, openSession } from "@/lib/cash";
import { setCategoryPhoto, setProductPhoto } from "@/lib/images";
import { normalizePhone, type LoyaltyStatus } from "@/lib/loyaltyRules";
import { loyaltyStatus } from "@/lib/loyalty";
import { ticketsByIds } from "@/lib/tickets-server";
import type { TicketData } from "@/lib/ticket";
import type { Expense, OrderStatus, PaymentMethod } from "@/lib/types";
import {
  EXPENSE_CATEGORIES,
  ORDER_STATUS_LABEL,
  productLabel,
} from "@/lib/types";

function done() {
  revalidatePath("/", "layout");
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string) => {
  const n = Math.round(Number(f.get(k) ?? 0));
  return Number.isFinite(n) ? n : 0;
};
const num = (f: FormData, k: string) => {
  const n = Number(f.get(k) ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ---------- Sesión ----------

export async function login(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  if (!passwordConfigured()) {
    return "Falta configurar ADMIN_PASSWORD en las variables de entorno de este despliegue (y volver a desplegar).";
  }
  if (!checkPassword(str(formData, "password"))) return "Contraseña incorrecta";
  await startSession();
  redirect("/admin");
}

export async function logout() {
  await endSession();
  redirect("/admin/login");
}

// ---------- Punto de venta ----------

export async function posSale(input: {
  items: { productId: number; qty: number }[];
  paymentMethod: PaymentMethod;
  cashGiven: number | null; // centavos
  customerName: string;
  /** teléfono del cliente para el programa de lealtad (opcional) */
  phone?: string;
  /** canjear la bebida gratis del teléfono (en caja la verifica quien atiende) */
  useReward?: boolean;
}): Promise<
  | {
      ok: true;
      orderId: number;
      total: number;
      change: number;
      ticket: TicketData | null;
    }
  | { ok: false; error: string }
> {
  await requireAdmin();
  const pm: PaymentMethod = ["efectivo", "tarjeta", "transferencia"].includes(
    input.paymentMethod,
  )
    ? input.paymentMethod
    : "efectivo";
  try {
    const order = await createOrder({
      channel: "mostrador",
      items: input.items,
      customerName: input.customerName,
      phone: normalizePhone(input.phone ?? ""),
      redeemRewardFor: input.useReward ? input.phone : undefined,
      deliveryType: "mostrador",
      paymentMethod: pm,
      paid: true,
      status: "entregado",
      cashGiven: pm === "efectivo" ? input.cashGiven : null,
      cashMustCover: true,
    });
    done();
    // El ticket va en la respuesta para imprimir y abrir el cajón de inmediato (sin otra consulta)
    const [ticket] = await ticketsByIds([order.id]);
    return {
      ok: true,
      orderId: order.id,
      total: order.total,
      change:
        pm === "efectivo" && input.cashGiven
          ? input.cashGiven - order.total
          : 0,
      ticket: ticket ?? null,
    };
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message };
    throw e;
  }
}

// ---------- Pedidos ----------

export async function updateOrderStatus(orderId: number, status: OrderStatus) {
  await requireAdmin();
  if (!(status in ORDER_STATUS_LABEL)) return;
  await setOrderStatus(orderId, status);
  done();
}

/** Cancelar una venta o pedido (también los ya entregados, p. ej. ventas de caja). */
export async function cancelOrder(
  orderId: number,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!reason.trim())
    return { ok: false, error: "Escribe el motivo de la cancelación." };
  try {
    await setOrderStatus(orderId, "cancelado", reason);
    done();
    return { ok: true };
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Eliminar definitivamente (solo ventas ya canceladas). */
export async function deleteOrder(
  orderId: number,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  try {
    await deleteCancelledOrder(orderId);
    done();
    return { ok: true };
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function markPaid(orderId: number) {
  await requireAdmin();
  await markOrderPaid(orderId);
  done();
}

// ---------- Productos (menú) ----------

export async function saveProduct(formData: FormData) {
  await requireAdmin();
  const id = int(formData, "id");
  const name = str(formData, "name");
  if (!name) return;
  const days = formData
    .getAll("days")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const values = [
    name,
    str(formData, "icon").slice(0, 8),
    str(formData, "size"),
    days.length === 7 ? "" : days.join(","),
    str(formData, "description"),
    str(formData, "category") || "General",
    toCents(formData.get("price")),
    toCents(formData.get("cost")),
    formData.get("track_stock") ? 1 : 0,
    int(formData, "min_stock"),
    str(formData, "image_url"),
    formData.get("active") ? 1 : 0,
    int(formData, "sort"),
    formData.get("pos_only") ? 1 : 0,
  ];
  const imageUrl = str(formData, "image_url");
  if (id) {
    const prev = await get<{ image_url: string }>("SELECT image_url FROM products WHERE id = ?", [id]);
    await run(
      `UPDATE products SET name=?, icon=?, size=?, available_days=?, description=?, category=?, price=?, cost=?, track_stock=?, min_stock=?, image_url=?, active=?, sort=?, pos_only=? WHERE id=?`,
      [...values, id],
    );
    // Foto nueva o quitada: se aplica a todos los tamaños y se borra la anterior si ya nadie la usa
    if (prev && prev.image_url !== imageUrl) await setProductPhoto(id, imageUrl);
  } else {
    // Un tamaño nuevo de un producto que ya tiene foto la hereda
    const sibling = imageUrl
      ? null
      : await get<{ image_url: string }>("SELECT image_url FROM products WHERE name = ? AND image_url <> '' LIMIT 1", [name]);
    if (sibling) values[10] = sibling.image_url;
    await run(
      `INSERT INTO products (name, icon, size, available_days, description, category, price, cost, track_stock, min_stock, image_url, active, sort, pos_only, stock)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [...values, int(formData, "stock")],
    );
  }
  done();
  redirect("/admin/productos");
}

export async function toggleProduct(id: number) {
  await requireAdmin();
  await run("UPDATE products SET active = 1 - active WHERE id = ?", [id]);
  done();
}

// ---------- Inventario ----------

/** Campo "item" con formato "product:3" o "supply:7". */
function parseItem(formData: FormData): {
  type: "product" | "supply";
  id: number;
} {
  const [t, i] = str(formData, "item").split(":");
  return {
    type: t === "supply" ? "supply" : "product",
    id: Math.round(Number(i)) || 0,
  };
}

async function addExpense(e: {
  date: string;
  category: string;
  description: string;
  amount: number;
  status: string;
}) {
  await run(
    "INSERT INTO expenses (date, category, description, amount, status, paid_at) VALUES (?,?,?,?,?,?)",
    [
      e.date,
      e.category,
      e.description,
      e.amount,
      e.status,
      e.status === "pagado" ? new Date().toISOString() : null,
    ],
  );
}

/** Entrada de mercancía. Opcionalmente registra el gasto y actualiza el costo unitario. */
export async function restock(formData: FormData) {
  await requireAdmin();
  const { type, id } = parseItem(formData);
  const qty = num(formData, "qty");
  const totalCost = toCents(formData.get("total_cost"));
  if (!id || qty <= 0) return;

  const table = type === "product" ? "products" : "supplies";
  const item = await get<{ name: string; size?: string }>(
    `SELECT * FROM ${table} WHERE id = ?`,
    [id],
  );
  if (!item) return;

  await transaction(async (q) => {
    if (type === "product")
      await q("UPDATE products SET stock = stock + ? WHERE id = ?", [
        Math.round(qty),
        id,
      ]);
    else await q("UPDATE supplies SET qty = qty + ? WHERE id = ?", [qty, id]);
    await q(
      "INSERT INTO inventory_movements (item_type, item_id, change, reason, note) VALUES (?,?,?,?,?)",
      [
        type,
        id,
        type === "product" ? Math.round(qty) : qty,
        "resurtido",
        str(formData, "note"),
      ],
    );
    if (totalCost > 0 && formData.get("update_cost")) {
      const unit = Math.round(totalCost / qty);
      if (type === "product")
        await q("UPDATE products SET cost = ? WHERE id = ?", [unit, id]);
      else
        await q("UPDATE supplies SET cost_per_unit = ? WHERE id = ?", [
          unit,
          id,
        ]);
    }
  });

  if (totalCost > 0 && formData.get("register_expense")) {
    await addExpense({
      date: localDate(),
      category: "resurtido",
      description: `Resurtido: ${qty} × ${productLabel(item)}`,
      amount: totalCost,
      status: formData.get("expense_pending") ? "pendiente" : "pagado",
    });
  }
  done();
}

/** Ajuste manual (merma, conteo físico, consumo de insumos). */
export async function adjustStock(formData: FormData) {
  await requireAdmin();
  const { type, id } = parseItem(formData);
  const newQty = num(formData, "new_qty");
  if (!id || newQty < 0) return;
  const row =
    type === "product"
      ? await get<{ q: number }>(
          "SELECT stock AS q FROM products WHERE id = ?",
          [id],
        )
      : await get<{ q: number }>("SELECT qty AS q FROM supplies WHERE id = ?", [
          id,
        ]);
  if (!row) return;
  const target = type === "product" ? Math.round(newQty) : newQty;
  const change = target - Number(row.q);
  if (change === 0) return;
  await transaction(async (q) => {
    if (type === "product")
      await q("UPDATE products SET stock = ? WHERE id = ?", [target, id]);
    else await q("UPDATE supplies SET qty = ? WHERE id = ?", [target, id]);
    await q(
      "INSERT INTO inventory_movements (item_type, item_id, change, reason, note) VALUES (?,?,?,?,?)",
      [type, id, change, "ajuste", str(formData, "note")],
    );
  });
  done();
}

export async function saveSupply(formData: FormData) {
  await requireAdmin();
  const id = int(formData, "id");
  const name = str(formData, "name");
  if (!name) return;
  const unit = str(formData, "unit") || "pza";
  const minQty = num(formData, "min_qty");
  const cpu = toCents(formData.get("cost_per_unit"));
  if (id) {
    await transaction(async (q) => {
      await q(
        "UPDATE supplies SET name=?, unit=?, min_qty=?, cost_per_unit=? WHERE id=?",
        [name, unit, minQty, cpu, id],
      );
      // Si cambió la existencia, queda registrado como ajuste
      if (formData.has("qty")) await setQtyWithMovement(q, "supply", id, num(formData, "qty"));
    });
  } else {
    await run(
      "INSERT INTO supplies (name, unit, qty, min_qty, cost_per_unit) VALUES (?,?,?,?,?)",
      [name, unit, num(formData, "qty"), minQty, cpu],
    );
  }
  done();
}

type Q = Parameters<Parameters<typeof transaction>[0]>[0];
async function setQtyWithMovement(q: Q, type: "product" | "supply", id: number, value: number) {
  if (!Number.isFinite(value) || value < 0) return;
  const target = type === "product" ? Math.round(value) : value;
  const [row] =
    type === "product"
      ? await q<{ v: number }>("SELECT stock AS v FROM products WHERE id = ? FOR UPDATE", [id])
      : await q<{ v: number }>("SELECT qty AS v FROM supplies WHERE id = ? FOR UPDATE", [id]);
  if (!row) return;
  const change = target - Number(row.v);
  if (Math.abs(change) < 1e-9) return;
  if (type === "product") await q("UPDATE products SET stock = ? WHERE id = ?", [target, id]);
  else await q("UPDATE supplies SET qty = ? WHERE id = ?", [target, id]);
  await q("INSERT INTO inventory_movements (item_type, item_id, change, reason, note) VALUES (?,?,?,?,?)", [
    type,
    id,
    change,
    "ajuste",
    "Editado en la lista de inventario",
  ]);
}

/** Edición rápida de un producto desde Inventario: precio, costo, existencia y mínimo. */
export async function saveInventoryProduct(formData: FormData) {
  await requireAdmin();
  const id = int(formData, "id");
  if (!id) return;
  const price = toCents(formData.get("price"));
  const cost = toCents(formData.get("cost"));
  const minStock = Math.max(0, Math.round(num(formData, "min_stock")));
  await transaction(async (q) => {
    await q("UPDATE products SET price = ?, cost = ?, min_stock = ? WHERE id = ?", [Math.max(price, 0), Math.max(cost, 0), minStock, id]);
    if (formData.has("stock")) await setQtyWithMovement(q, "product", id, num(formData, "stock"));
  });
  done();
}

export async function deleteSupply(id: number) {
  await requireAdmin();
  await run("DELETE FROM supplies WHERE id = ?", [id]);
  done();
}

// ---------- Gastos ----------

export async function saveExpense(formData: FormData) {
  await requireAdmin();
  const id = int(formData, "id");
  const amount = toCents(formData.get("amount"));
  const category = str(formData, "category");
  if (amount <= 0 || !(category in EXPENSE_CATEGORIES)) return;
  const date = str(formData, "date") || localDate();
  const status =
    str(formData, "status") === "pendiente" ? "pendiente" : "pagado";
  const r = str(formData, "recurring");
  const recurring: Expense["recurring"] =
    r === "monthly" || r === "weekly" ? r : "none";
  const description = str(formData, "description");
  if (id) {
    await run(
      "UPDATE expenses SET date=?, category=?, description=?, amount=?, status=?, recurring=? WHERE id=?",
      [date, category, description, amount, status, recurring, id],
    );
  } else {
    await run(
      "INSERT INTO expenses (date, category, description, amount, status, recurring, paid_at) VALUES (?,?,?,?,?,?,?)",
      [
        date,
        category,
        description,
        amount,
        status,
        recurring,
        status === "pagado" ? new Date().toISOString() : null,
      ],
    );
    if (status === "pagado" && recurring !== "none")
      await scheduleNext({ date, category, description, amount, recurring });
  }
  done();
}

/** Para gastos fijos (renta, luz…): al pagarlos se agenda el siguiente como pendiente. */
async function scheduleNext(
  e: Pick<
    Expense,
    "date" | "category" | "description" | "amount" | "recurring"
  >,
) {
  const next =
    e.recurring === "monthly" ? addMonths(e.date, 1) : addDays(e.date, 7);
  const exists = await get(
    "SELECT id FROM expenses WHERE category = ? AND description = ? AND date = ? AND recurring = ?",
    [e.category, e.description, next, e.recurring],
  );
  if (!exists) {
    await run(
      "INSERT INTO expenses (date, category, description, amount, status, recurring) VALUES (?,?,?,?, 'pendiente', ?)",
      [next, e.category, e.description, e.amount, e.recurring],
    );
  }
}

export async function payExpense(id: number) {
  await requireAdmin();
  const e = await get<Expense>("SELECT * FROM expenses WHERE id = ?", [id]);
  if (!e || e.status === "pagado") return;
  await run("UPDATE expenses SET status = 'pagado', paid_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
  if (e.recurring !== "none") await scheduleNext(e);
  done();
}

export async function deleteExpense(id: number) {
  await requireAdmin();
  await run("DELETE FROM expenses WHERE id = ?", [id]);
  done();
}

// ---------- Ajustes ----------

export async function saveSettings(formData: FormData) {
  await requireAdmin();
  await setSetting(
    "business_name",
    str(formData, "business_name") || "Mi cafetería",
  );
  await setSetting(
    "whatsapp_number",
    str(formData, "whatsapp_number").replace(/[^\d+]/g, ""),
  );
  const address = str(formData, "address");
  const prev = await getSettings();
  await setSetting("address", address);
  // Nueva dirección sin ubicación fijada a mano: se vuelve a ubicar en el mapa en el siguiente envío
  if (address !== prev.address && !prev.cafe_location_manual) {
    await setSetting("cafe_lat", "");
    await setSetting("cafe_lng", "");
  }
  await setSetting("hours", str(formData, "hours"));
  await setSetting(
    "delivery_enabled",
    formData.get("delivery_enabled") ? "1" : "0",
  );
  await setSetting("store_open", formData.get("store_open") ? "1" : "0");
  await setSetting(
    "min_delivery_order",
    String(toCents(formData.get("min_delivery_order"))),
  );
  done();
}

/** Convierte un link de Google Maps (también los cortos maps.app.goo.gl) en coordenadas. */
export async function coordsFromMapsLink(
  text: string,
): Promise<{ ok: true; lat: number; lng: number } | { ok: false; message: string }> {
  await requireAdmin();
  const direct = parseCoords(text);
  if (direct) return { ok: true, ...direct };
  if (isShortMapsLink(text)) {
    const c = await resolveShortMapsLink(text).catch(() => null);
    if (c) return { ok: true, ...c };
  }
  return {
    ok: false,
    message:
      "No encontramos coordenadas en ese link. En Google Maps mantén presionado sobre tu local y copia los números que aparecen.",
  };
}

export async function saveDeliverySettings(formData: FormData) {
  await requireAdmin();
  const km = (k: string) => String(Math.min(Math.max(Math.round(num(formData, k) * 10) / 10, 0), 500));
  await setSetting("delivery_fee", String(toCents(formData.get("delivery_fee"))));
  await setSetting("delivery_base_km", km("base_km"));
  await setSetting("delivery_per_km", String(toCents(formData.get("per_km"))));
  await setSetting("delivery_max_km", km("max_km"));
  await setSetting("free_delivery_from", String(toCents(formData.get("free_delivery_from"))));
  // Ubicación de la cafetería: "lat, lng" o link de Google Maps (vacío = usar la dirección del negocio)
  const raw = str(formData, "cafe_coords");
  const c = parseCoords(raw) ?? (isShortMapsLink(raw) ? await resolveShortMapsLink(raw).catch(() => null) : null);
  if (c) {
    await setSetting("cafe_lat", String(c.lat));
    await setSetting("cafe_lng", String(c.lng));
    await setSetting("cafe_location_manual", "1");
  } else if (!raw) {
    await setSetting("cafe_lat", "");
    await setSetting("cafe_lng", "");
    await setSetting("cafe_location_manual", "0");
  }
  done();
}


// ---------- Comisión por pago en línea ----------

export async function saveOnlineFee(formData: FormData) {
  await requireAdmin();
  const clamp = (n: number, max: number) =>
    String(Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), max));
  await setSetting("online_fee_enabled", formData.get("enabled") ? "1" : "0");
  await setSetting("online_fee_percent", clamp(num(formData, "percent"), 20));
  await setSetting("online_fee_fixed", String(toCents(formData.get("fixed"))));
  await setSetting("online_fee_iva", clamp(num(formData, "iva"), 30));
  done();
}

// ---------- Lealtad ----------

/** Sellos de un cliente (para la caja). */
export async function getLoyalty(phone: string): Promise<LoyaltyStatus | null> {
  await requireAdmin();
  return loyaltyStatus(phone);
}

export async function saveLoyaltySettings(formData: FormData) {
  await requireAdmin();
  await setSetting("loyalty_enabled", formData.get("enabled") ? "1" : "0");
  await setSetting(
    "loyalty_stamps_needed",
    String(Math.min(Math.max(int(formData, "needed"), 1), 50)),
  );
  await setSetting(
    "loyalty_min_purchase",
    String(toCents(formData.get("min"))),
  );
  await setSetting(
    "loyalty_stamp_months",
    String(Math.min(Math.max(int(formData, "months"), 1), 24)),
  );
  await setSetting(
    "loyalty_reward_days",
    String(Math.min(Math.max(int(formData, "days"), 1), 365)),
  );
  done();
}

export async function saveNtfySettings(formData: FormData) {
  await requireAdmin();
  const topic = String(formData.get("topic") ?? "").trim();
  if (topic && !/^[\w-]{1,64}$/.test(topic))
    throw new Error(
      "El tema solo puede tener letras, números, - y _ (máx. 64).",
    );
  const server = String(formData.get("server") ?? "")
    .trim()
    .replace(/\/$/, "");
  if (server && !/^https?:\/\/[^\s/]+$/.test(server))
    throw new Error("El servidor debe ser una dirección como https://ntfy.sh");
  await setSetting("ntfy_topic", topic);
  await setSetting("ntfy_server", server);
  await setSetting("ntfy_new", formData.get("new") ? "1" : "0");
  await setSetting("ntfy_updates", formData.get("updates") ? "1" : "0");
  await setSetting("ntfy_pos", formData.get("pos") ? "1" : "0");
  done();
}

export async function testNtfy(): Promise<{ ok: boolean; text: string }> {
  await requireAdmin();
  const { ntfy, business_name } = await getSettings();
  if (!ntfy.topic)
    return { ok: false, text: "Primero guarda el nombre del tema." };
  const err = await sendNtfy(ntfy, {
    title: `✅ ${business_name}: avisos activados`,
    message: "Así te llegarán los pedidos nuevos y sus cambios.",
    tags: ["white_check_mark"],
    priority: 4,
  });
  const where = `${ntfy.server.replace(/^https?:\/\//, "")}/${ntfy.topic}`;
  return err
    ? { ok: false, text: `No se pudo enviar a ${where}: ${err}` }
    : {
        ok: true,
        text: `✓ Enviado al tema ${where}. Si no te llegó, revisa que la app ntfy esté suscrita a ese mismo tema.`,
      };
}

// ---------- Reparto (la lógica vive en lib/deliveryRoute.ts) ----------

export async function planDeliveryRoute(orderIds: number[], returnToCafe: boolean): Promise<RouteResult> {
  await requireAdmin();
  return planRoute(orderIds, returnToCafe);
}

/** Marca "En camino" varios pedidos a la vez (salida del repartidor). */
export async function markOrdersOnTheWay(orderIds: number[]) {
  await requireAdmin();
  await markOnTheWay(orderIds, null);
  done();
}

export async function deliverOrder(orderId: number) {
  await requireAdmin();
  await markDelivered(orderId, null);
  done();
}

// ---------- Repartidores ----------

function driversBack(msg: string, ok = true): never {
  redirect(`/admin/repartidores?${ok ? "ok" : "error"}=${encodeURIComponent(msg)}`);
}

export async function createDriver(formData: FormData) {
  await requireAdmin();
  const name = str(formData, "name").slice(0, 60);
  const phone = normalizePhone(str(formData, "phone"));
  const pin = str(formData, "pin");
  if (!name) driversBack("Escribe el nombre del repartidor.", false);
  if (!phone) driversBack("Escribe un teléfono de 10 dígitos.", false);
  if (!validPin(pin)) driversBack("El PIN debe tener exactamente 6 números.", false);
  const exists = await get<{ id: number }>("SELECT id FROM drivers WHERE phone = ?", [phone]);
  if (exists) driversBack("Ya hay un repartidor con ese teléfono.", false);
  await run("INSERT INTO drivers (name, phone, pin_hash) VALUES (?, ?, ?)", [name, phone, hashPin(pin)]);
  driversBack(`${name} ya puede entrar en /repartidor con su teléfono y PIN.`);
}

export async function updateDriver(formData: FormData) {
  await requireAdmin();
  const id = int(formData, "id");
  const name = str(formData, "name").slice(0, 60);
  const phone = normalizePhone(str(formData, "phone"));
  if (!id || !name || !phone) driversBack("Revisa el nombre y el teléfono.", false);
  const other = await get<{ id: number }>("SELECT id FROM drivers WHERE phone = ? AND id <> ?", [phone, id]);
  if (other) driversBack("Ya hay otro repartidor con ese teléfono.", false);
  await run("UPDATE drivers SET name = ?, phone = ? WHERE id = ?", [name, phone, id]);
  driversBack("Datos guardados.");
}

/** Nuevo PIN: también cierra la sesión que tenga abierta y quita el bloqueo por intentos. */
export async function resetDriverPin(formData: FormData) {
  await requireAdmin();
  const id = int(formData, "id");
  const pin = str(formData, "pin");
  if (!validPin(pin)) driversBack("El PIN debe tener exactamente 6 números.", false);
  await run(
    "UPDATE drivers SET pin_hash = ?, session_version = session_version + 1, failed_attempts = 0, locked_until = NULL WHERE id = ?",
    [hashPin(pin), id],
  );
  driversBack("PIN cambiado. Su sesión anterior se cerró.");
}

/** Activar/desactivar: al desactivar se cierra su sesión al instante. */
export async function toggleDriver(id: number) {
  await requireAdmin();
  const d = await get<{ active: number; name: string }>("SELECT active, name FROM drivers WHERE id = ?", [id]);
  if (!d) driversBack("No existe ese repartidor.", false);
  await run("UPDATE drivers SET active = ?, session_version = session_version + 1 WHERE id = ?", [d.active ? 0 : 1, id]);
  driversBack(d.active ? `${d.name} ya no puede entrar.` : `${d.name} puede volver a entrar.`);
}

export async function deleteDriver(id: number) {
  await requireAdmin();
  await run("DELETE FROM drivers WHERE id = ?", [id]);
  driversBack("Repartidor eliminado.");
}

export async function saveScheduleSettings(formData: FormData) {
  await requireAdmin();
  const time = (k: string) => {
    const v = str(formData, k);
    return /^\d{2}:\d{2}$/.test(v) ? v : "";
  };
  // Turnos de cada día (0 = domingo); un turno sin las dos horas o al revés se ignora
  const week = Array.from({ length: 7 }, (_, d) => {
    if (!formData.get(`d${d}_on`)) return [];
    return [1, 2]
      .map((n) => ({ open: time(`d${d}_o${n}`), close: time(`d${d}_c${n}`) }))
      .filter((sh) => sh.open && sh.close && sh.close > sh.open);
  });
  await setSetting("sched_enabled", formData.get("enabled") ? "1" : "0");
  await setSetting("sched_week", JSON.stringify(week));
  await setSetting("sched_prep", String(Math.min(Math.max(Math.round(num(formData, "prep")), 0), 240)));
  await setSetting("sched_ahead", String(Math.min(Math.max(int(formData, "ahead"), 0), 6)));
  done();
}

// ---------- Corte de caja ----------

function cashBack(params: Record<string, string>): never {
  redirect(`/admin/caja?${new URLSearchParams(params).toString()}`);
}

export async function openCash(formData: FormData) {
  await requireAdmin();
  try {
    await openSession(toCents(formData.get("opening")), str(formData, "note"));
  } catch (e) {
    if (e instanceof CashError) cashBack({ error: e.message });
    throw e;
  }
  cashBack({ ok: "Caja abierta. ¡Buen turno!" });
}

export async function cashMovement(formData: FormData) {
  await requireAdmin();
  const kind = str(formData, "kind") === "entrada" ? "entrada" : "salida";
  try {
    await addMovement(kind, toCents(formData.get("amount")), str(formData, "reason"));
  } catch (e) {
    if (e instanceof CashError) cashBack({ error: e.message });
    throw e;
  }
  cashBack({ ok: kind === "entrada" ? "Entrada registrada." : "Salida registrada." });
}

export async function closeCash(formData: FormData) {
  await requireAdmin();
  if (str(formData, "counted") === "") cashBack({ error: "Escribe cuánto efectivo contaste en el cajón." });
  let id: number;
  try {
    id = await closeSession(toCents(formData.get("counted")), str(formData, "note"));
  } catch (e) {
    if (e instanceof CashError) cashBack({ error: e.message });
    throw e;
  }
  cashBack({ id: String(id), ok: "Caja cerrada." });
}

/** Quita la foto del producto (y de sus tamaños) y la borra del almacenamiento si ya nadie la usa. */
export async function removeProductPhoto(productId: number) {
  await requireAdmin();
  await setProductPhoto(Number(productId), "");
  done();
}

export async function removeCategoryPhoto(category: string) {
  await requireAdmin();
  await setCategoryPhoto(String(category), "");
  done();
}
