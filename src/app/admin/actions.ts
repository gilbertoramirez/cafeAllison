"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPassword, endSession, passwordConfigured, requireAdmin, startSession } from "@/lib/auth";
import { get, run, transaction } from "@/lib/db";
import { addDays, addMonths, localDate, toCents } from "@/lib/format";
import { createOrder, markOrderPaid, OrderError, setOrderStatus } from "@/lib/orders";
import { setSetting } from "@/lib/settings";
import type { Expense, OrderStatus, PaymentMethod } from "@/lib/types";
import { EXPENSE_CATEGORIES, ORDER_STATUS_LABEL } from "@/lib/types";

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

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
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
}): Promise<{ ok: true; orderId: number; total: number; change: number } | { ok: false; error: string }> {
  await requireAdmin();
  const pm: PaymentMethod = ["efectivo", "tarjeta", "transferencia"].includes(input.paymentMethod)
    ? input.paymentMethod
    : "efectivo";
  try {
    const order = await createOrder({
      channel: "mostrador",
      items: input.items,
      customerName: input.customerName,
      deliveryType: "mostrador",
      paymentMethod: pm,
      paid: true,
      status: "entregado",
      cashGiven: pm === "efectivo" ? input.cashGiven : null,
      cashMustCover: true,
    });
    done();
    return {
      ok: true,
      orderId: order.id,
      total: order.total,
      change: pm === "efectivo" && input.cashGiven ? input.cashGiven - order.total : 0,
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
  const values = [
    name,
    str(formData, "description"),
    str(formData, "category") || "General",
    toCents(formData.get("price")),
    toCents(formData.get("cost")),
    formData.get("track_stock") ? 1 : 0,
    int(formData, "min_stock"),
    str(formData, "image_url"),
    formData.get("active") ? 1 : 0,
    int(formData, "sort"),
  ];
  if (id) {
    await run(
      `UPDATE products SET name=?, description=?, category=?, price=?, cost=?, track_stock=?, min_stock=?, image_url=?, active=?, sort=? WHERE id=?`,
      [...values, id],
    );
  } else {
    await run(
      `INSERT INTO products (name, description, category, price, cost, track_stock, min_stock, image_url, active, sort, stock)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
function parseItem(formData: FormData): { type: "product" | "supply"; id: number } {
  const [t, i] = str(formData, "item").split(":");
  return { type: t === "supply" ? "supply" : "product", id: Math.round(Number(i)) || 0 };
}

async function addExpense(e: { date: string; category: string; description: string; amount: number; status: string }) {
  await run("INSERT INTO expenses (date, category, description, amount, status, paid_at) VALUES (?,?,?,?,?,?)", [
    e.date,
    e.category,
    e.description,
    e.amount,
    e.status,
    e.status === "pagado" ? new Date().toISOString() : null,
  ]);
}

/** Entrada de mercancía. Opcionalmente registra el gasto y actualiza el costo unitario. */
export async function restock(formData: FormData) {
  await requireAdmin();
  const { type, id } = parseItem(formData);
  const qty = num(formData, "qty");
  const totalCost = toCents(formData.get("total_cost"));
  if (!id || qty <= 0) return;

  const table = type === "product" ? "products" : "supplies";
  const item = await get<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, [id]);
  if (!item) return;

  await transaction(async (q) => {
    if (type === "product") await q("UPDATE products SET stock = stock + ? WHERE id = ?", [Math.round(qty), id]);
    else await q("UPDATE supplies SET qty = qty + ? WHERE id = ?", [qty, id]);
    await q("INSERT INTO inventory_movements (item_type, item_id, change, reason, note) VALUES (?,?,?,?,?)", [
      type,
      id,
      type === "product" ? Math.round(qty) : qty,
      "resurtido",
      str(formData, "note"),
    ]);
    if (totalCost > 0 && formData.get("update_cost")) {
      const unit = Math.round(totalCost / qty);
      if (type === "product") await q("UPDATE products SET cost = ? WHERE id = ?", [unit, id]);
      else await q("UPDATE supplies SET cost_per_unit = ? WHERE id = ?", [unit, id]);
    }
  });

  if (totalCost > 0 && formData.get("register_expense")) {
    await addExpense({
      date: localDate(),
      category: "resurtido",
      description: `Resurtido: ${qty} × ${item.name}`,
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
      ? await get<{ q: number }>("SELECT stock AS q FROM products WHERE id = ?", [id])
      : await get<{ q: number }>("SELECT qty AS q FROM supplies WHERE id = ?", [id]);
  if (!row) return;
  const target = type === "product" ? Math.round(newQty) : newQty;
  const change = target - Number(row.q);
  if (change === 0) return;
  await transaction(async (q) => {
    if (type === "product") await q("UPDATE products SET stock = ? WHERE id = ?", [target, id]);
    else await q("UPDATE supplies SET qty = ? WHERE id = ?", [target, id]);
    await q("INSERT INTO inventory_movements (item_type, item_id, change, reason, note) VALUES (?,?,?,?,?)", [
      type,
      id,
      change,
      "ajuste",
      str(formData, "note"),
    ]);
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
    await run("UPDATE supplies SET name=?, unit=?, min_qty=?, cost_per_unit=? WHERE id=?", [name, unit, minQty, cpu, id]);
  } else {
    await run("INSERT INTO supplies (name, unit, qty, min_qty, cost_per_unit) VALUES (?,?,?,?,?)", [
      name,
      unit,
      num(formData, "qty"),
      minQty,
      cpu,
    ]);
  }
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
  const status = str(formData, "status") === "pendiente" ? "pendiente" : "pagado";
  const r = str(formData, "recurring");
  const recurring: Expense["recurring"] = r === "monthly" || r === "weekly" ? r : "none";
  const description = str(formData, "description");
  if (id) {
    await run("UPDATE expenses SET date=?, category=?, description=?, amount=?, status=?, recurring=? WHERE id=?", [
      date,
      category,
      description,
      amount,
      status,
      recurring,
      id,
    ]);
  } else {
    await run(
      "INSERT INTO expenses (date, category, description, amount, status, recurring, paid_at) VALUES (?,?,?,?,?,?,?)",
      [date, category, description, amount, status, recurring, status === "pagado" ? new Date().toISOString() : null],
    );
    if (status === "pagado" && recurring !== "none") await scheduleNext({ date, category, description, amount, recurring });
  }
  done();
}

/** Para gastos fijos (renta, luz…): al pagarlos se agenda el siguiente como pendiente. */
async function scheduleNext(e: Pick<Expense, "date" | "category" | "description" | "amount" | "recurring">) {
  const next = e.recurring === "monthly" ? addMonths(e.date, 1) : addDays(e.date, 7);
  const exists = await get(
    "SELECT id FROM expenses WHERE category = ? AND description = ? AND date = ? AND recurring = ?",
    [e.category, e.description, next, e.recurring],
  );
  if (!exists) {
    await run("INSERT INTO expenses (date, category, description, amount, status, recurring) VALUES (?,?,?,?, 'pendiente', ?)", [
      next,
      e.category,
      e.description,
      e.amount,
      e.recurring,
    ]);
  }
}

export async function payExpense(id: number) {
  await requireAdmin();
  const e = await get<Expense>("SELECT * FROM expenses WHERE id = ?", [id]);
  if (!e || e.status === "pagado") return;
  await run("UPDATE expenses SET status = 'pagado', paid_at = ? WHERE id = ?", [new Date().toISOString(), id]);
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
  await setSetting("business_name", str(formData, "business_name") || "Mi cafetería");
  await setSetting("whatsapp_number", str(formData, "whatsapp_number").replace(/[^\d+]/g, ""));
  await setSetting("address", str(formData, "address"));
  await setSetting("hours", str(formData, "hours"));
  await setSetting("delivery_enabled", formData.get("delivery_enabled") ? "1" : "0");
  await setSetting("store_open", formData.get("store_open") ? "1" : "0");
  await setSetting("delivery_fee", String(toCents(formData.get("delivery_fee"))));
  await setSetting("min_delivery_order", String(toCents(formData.get("min_delivery_order"))));
  done();
}
