import { randomBytes } from "node:crypto";
import { all, get, run, transaction } from "./db";
import { availableToday } from "./format";
import type { Order, OrderItem, OrderStatus, PaymentMethod, Product } from "./types";
import { daysLabel, productLabel } from "./types";

export class OrderError extends Error {}

export type NewOrderInput = {
  channel: Order["channel"];
  items: { productId: number; qty: number; note?: string }[];
  customerName?: string;
  phone?: string;
  deliveryType: Order["delivery_type"];
  address?: string;
  addressRef?: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string;
  paymentMethod: PaymentMethod;
  paid: boolean;
  status?: OrderStatus;
  cashGiven?: number | null;
  /** Calcula el envío según el subtotal (para envío gratis). */
  deliveryFee?: number | ((subtotal: number) => number);
  postalCode?: string;
  /** Precio unitario a cobrar (p. ej. precio en línea con comisión). Por defecto, el precio del producto. */
  priceFor?: (p: Product) => number;
  /**
   * Cargo extra por pago en línea. Recibe el importe a precios normales (más envío) y el importe
   * ya calculado a precios de este pedido; devuelve lo que falte para cubrir la comisión.
   */
  serviceFee?: (baseAmount: number, chargedAmount: number) => number;
  /** Comisión estimada del procesador para el total final (se guarda para finanzas). */
  processingFee?: (total: number) => number;
  minSubtotal?: number;
  /** Pedidos en línea: respeta los días de venta de cada producto. */
  enforceDays?: boolean;
  /** En mostrador: rechaza si el efectivo recibido no cubre el total. */
  cashMustCover?: boolean;
};

/**
 * Crea un pedido tomando precios y costos de la base de datos (nunca del cliente)
 * y descuenta inventario de los productos con control de stock.
 */
export async function createOrder(input: NewOrderInput): Promise<Order> {
  // Agrupa por producto + indicaciones (p.ej. dos frappés de sabores distintos son dos líneas)
  const merged = new Map<string, { productId: number; qty: number; note: string }>();
  const perProduct = new Map<number, number>();
  for (const it of input.items) {
    const qty = Math.floor(Number(it.qty));
    if (!Number.isInteger(it.productId) || qty <= 0) continue;
    const note = String(it.note ?? "").trim().slice(0, 120);
    const key = `${it.productId}|${note}`;
    const line = merged.get(key) ?? { productId: it.productId, qty: 0, note };
    line.qty += qty;
    merged.set(key, line);
    perProduct.set(it.productId, (perProduct.get(it.productId) ?? 0) + qty);
  }
  if (merged.size === 0) throw new OrderError("El pedido está vacío.");
  for (const qty of perProduct.values()) if (qty > 99) throw new OrderError("Cantidad no válida.");

  const orderId = await transaction(async (q) => {
    const ids = [...perProduct.keys()];
    // FOR UPDATE bloquea los productos para no vender más existencias de las que hay
    const rows = await q<Product>(
      `SELECT * FROM products WHERE id IN (${ids.map(() => "?").join(",")}) FOR UPDATE`,
      ids,
    );
    const products = new Map(rows.map((p) => [p.id, p]));

    for (const [id, qty] of perProduct) {
      const p = products.get(id);
      if (!p || !p.active) throw new OrderError("Uno de los productos ya no está disponible.");
      if (input.enforceDays && !availableToday(p.available_days)) {
        throw new OrderError(`"${productLabel(p)}" solo está disponible: ${daysLabel(p.available_days)}.`);
      }
      if (p.track_stock && p.stock < qty) {
        throw new OrderError(`Solo quedan ${Math.max(p.stock, 0)} de "${productLabel(p)}".`);
      }
    }
    let subtotal = 0;
    let baseSubtotal = 0;
    const lines: { p: Product; qty: number; note: string; price: number }[] = [];
    for (const { productId, qty, note } of merged.values()) {
      const p = products.get(productId)!;
      const price = input.priceFor ? input.priceFor(p) : p.price;
      subtotal += price * qty;
      baseSubtotal += p.price * qty;
      lines.push({ p, qty, note, price });
    }

    if (input.minSubtotal && subtotal < input.minSubtotal) {
      throw new OrderError("El pedido no alcanza el mínimo para entrega a domicilio.");
    }
    const fee = typeof input.deliveryFee === "function" ? input.deliveryFee(subtotal) : (input.deliveryFee ?? 0);
    const deliveryFee = input.deliveryType === "domicilio" ? fee : 0;
    const serviceFee = input.serviceFee ? input.serviceFee(baseSubtotal + deliveryFee, subtotal + deliveryFee) : 0;
    const total = subtotal + deliveryFee + serviceFee;
    const processingFee = input.processingFee ? input.processingFee(total) : 0;
    if (input.cashMustCover && input.cashGiven != null && input.cashGiven < total) {
      throw new OrderError("El efectivo recibido es menor al total.");
    }
    const token = randomBytes(9).toString("base64url");
    const now = new Date().toISOString();

    const [{ id: newId }] = await q<{ id: number }>(
      `INSERT INTO orders (token, channel, status, customer_name, phone, delivery_type, address, address_ref,
         lat, lng, notes, payment_method, payment_status, cash_given, subtotal, delivery_fee, total, created_at, paid_at, postal_code,
         service_fee, processing_fee, change_seq)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, nextval('orders_change_seq')) RETURNING id`,
      [
        token,
        input.channel,
        input.status ?? "nuevo",
        (input.customerName ?? "").slice(0, 120),
        (input.phone ?? "").slice(0, 30),
        input.deliveryType,
        (input.address ?? "").slice(0, 300),
        (input.addressRef ?? "").slice(0, 300),
        input.lat ?? null,
        input.lng ?? null,
        (input.notes ?? "").slice(0, 500),
        input.paymentMethod,
        input.paid ? "pagado" : "pendiente",
        input.cashGiven ?? null,
        subtotal,
        deliveryFee,
        total,
        now,
        input.paid ? now : null,
        (input.postalCode ?? "").slice(0, 10),
        serviceFee,
        processingFee,
      ],
    );

    for (const { p, qty, note, price } of lines) {
      await q(
        "INSERT INTO order_items (order_id, product_id, name, unit_price, unit_cost, qty, notes) VALUES (?,?,?,?,?,?,?)",
        [newId, p.id, productLabel(p), price, p.cost, qty, note],
      );
      if (p.track_stock) {
        await q("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, p.id]);
        await q(
          "INSERT INTO inventory_movements (item_type, item_id, change, reason, order_id) VALUES ('product', ?, ?, 'venta', ?)",
          [p.id, -qty, newId],
        );
      }
    }
    return newId;
  });
  return (await getOrderById(orderId))!;
}

export async function getOrderById(id: number) {
  return get<Order>("SELECT * FROM orders WHERE id = ?", [id]);
}

export async function getOrderByToken(token: string) {
  return get<Order>("SELECT * FROM orders WHERE token = ?", [token]);
}

export async function getOrderItems(orderId: number) {
  return all<OrderItem>("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", [orderId]);
}

export async function itemsForOrders(orderIds: number[]): Promise<Map<number, OrderItem[]>> {
  const map = new Map<number, OrderItem[]>();
  if (orderIds.length === 0) return map;
  const rows = await all<OrderItem>(
    `SELECT * FROM order_items WHERE order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY id`,
    orderIds,
  );
  for (const r of rows) {
    if (!map.has(r.order_id)) map.set(r.order_id, []);
    map.get(r.order_id)!.push(r);
  }
  return map;
}

/** Cambia el estado; al cancelar regresa el stock al inventario. */
/** Cambia el estado. Al cancelar regresa el stock y guarda motivo y fecha. */
export async function setOrderStatus(orderId: number, status: OrderStatus, reason = "") {
  await transaction(async (q) => {
    const [row] = await q<{ status: OrderStatus }>("SELECT status FROM orders WHERE id = ? FOR UPDATE", [orderId]);
    const prev = row?.status;
    if (!prev || prev === status) return;
    if (prev === "cancelado") throw new OrderError("Un pedido cancelado no se puede reabrir.");
    await q("UPDATE orders SET status = ?, change_seq = nextval('orders_change_seq') WHERE id = ?", [status, orderId]);
    if (status === "cancelado") {
      await q("UPDATE orders SET cancel_reason = ?, cancelled_at = ? WHERE id = ?", [
        reason.trim().slice(0, 200),
        new Date().toISOString(),
        orderId,
      ]);
      const items = await q<{ product_id: number; qty: number }>(
        `SELECT oi.product_id, oi.qty FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = ? AND p.track_stock = 1`,
        [orderId],
      );
      for (const it of items) {
        await q("UPDATE products SET stock = stock + ? WHERE id = ?", [it.qty, it.product_id]);
        await q(
          "INSERT INTO inventory_movements (item_type, item_id, change, reason, order_id) VALUES ('product', ?, ?, 'cancelacion', ?)",
          [it.product_id, it.qty, orderId],
        );
      }
    }
  });
}

/** Borra por completo un pedido que ya fue cancelado (pruebas o errores de captura). */
export async function deleteCancelledOrder(orderId: number) {
  await transaction(async (q) => {
    const [row] = await q<{ status: OrderStatus }>("SELECT status FROM orders WHERE id = ? FOR UPDATE", [orderId]);
    if (!row) return;
    if (row.status !== "cancelado") throw new OrderError("Primero cancela la venta; solo se pueden eliminar ventas canceladas.");
    // Los movimientos de venta y de cancelación se compensan, así que se borran juntos
    await q("DELETE FROM inventory_movements WHERE order_id = ?", [orderId]);
    await q("DELETE FROM order_items WHERE order_id = ?", [orderId]);
    await q("DELETE FROM orders WHERE id = ?", [orderId]);
  });
}

export async function markOrderPaid(orderId: number) {
  await run(
    `UPDATE orders SET payment_status = 'pagado', paid_at = COALESCE(paid_at, ?), change_seq = nextval('orders_change_seq')
     WHERE id = ? AND status != 'cancelado' AND payment_status <> 'pagado'`,
    [new Date().toISOString(), orderId],
  );
}

export function orderCode(id: number) {
  return "#" + String(id).padStart(4, "0");
}
