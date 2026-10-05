import { randomBytes } from "node:crypto";
import { all, db, get } from "./db";
import type { Order, OrderItem, OrderStatus, PaymentMethod, Product } from "./types";

export class OrderError extends Error {}

export type NewOrderInput = {
  channel: Order["channel"];
  items: { productId: number; qty: number }[];
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
  deliveryFee?: number;
  minSubtotal?: number;
  /** En mostrador: rechaza si el efectivo recibido no cubre el total. */
  cashMustCover?: boolean;
};

/**
 * Crea un pedido tomando precios y costos de la base de datos (nunca del cliente)
 * y descuenta inventario de los productos con control de stock.
 */
export async function createOrder(input: NewOrderInput): Promise<Order> {
  const merged = new Map<number, number>();
  for (const it of input.items) {
    const qty = Math.floor(Number(it.qty));
    if (!Number.isInteger(it.productId) || qty <= 0) continue;
    merged.set(it.productId, (merged.get(it.productId) ?? 0) + qty);
  }
  if (merged.size === 0) throw new OrderError("El pedido está vacío.");
  for (const qty of merged.values()) if (qty > 99) throw new OrderError("Cantidad no válida.");

  const client = await db();
  const tx = await client.transaction("write");
  try {
    const ids = [...merged.keys()];
    const res = await tx.execute({
      sql: `SELECT * FROM products WHERE id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
    const products = new Map((res.rows as unknown as Product[]).map((p) => [p.id, p]));

    let subtotal = 0;
    const lines: { p: Product; qty: number }[] = [];
    for (const [id, qty] of merged) {
      const p = products.get(id);
      if (!p || !p.active) throw new OrderError("Uno de los productos ya no está disponible.");
      if (p.track_stock && p.stock < qty) {
        throw new OrderError(`Solo quedan ${Math.max(p.stock, 0)} de "${p.name}".`);
      }
      subtotal += p.price * qty;
      lines.push({ p, qty });
    }

    if (input.minSubtotal && subtotal < input.minSubtotal) {
      throw new OrderError("El pedido no alcanza el mínimo para entrega a domicilio.");
    }
    const deliveryFee = input.deliveryType === "domicilio" ? (input.deliveryFee ?? 0) : 0;
    const total = subtotal + deliveryFee;
    if (input.cashMustCover && input.cashGiven != null && input.cashGiven < total) {
      throw new OrderError("El efectivo recibido es menor al total.");
    }
    const token = randomBytes(9).toString("base64url");
    const now = new Date().toISOString();

    const ins = await tx.execute({
      sql: `INSERT INTO orders (token, channel, status, customer_name, phone, delivery_type, address, address_ref,
              lat, lng, notes, payment_method, payment_status, cash_given, subtotal, delivery_fee, total, created_at, paid_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
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
      ],
    });
    const orderId = Number(ins.lastInsertRowid);

    for (const { p, qty } of lines) {
      await tx.execute({
        sql: "INSERT INTO order_items (order_id, product_id, name, unit_price, unit_cost, qty) VALUES (?,?,?,?,?,?)",
        args: [orderId, p.id, p.name, p.price, p.cost, qty],
      });
      if (p.track_stock) {
        await tx.execute({ sql: "UPDATE products SET stock = stock - ? WHERE id = ?", args: [qty, p.id] });
        await tx.execute({
          sql: "INSERT INTO inventory_movements (item_type, item_id, change, reason, order_id) VALUES ('product', ?, ?, 'venta', ?)",
          args: [p.id, -qty, orderId],
        });
      }
    }
    await tx.commit();
    return (await getOrderById(orderId))!;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
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
export async function setOrderStatus(orderId: number, status: OrderStatus) {
  const client = await db();
  const tx = await client.transaction("write");
  try {
    const r = await tx.execute({ sql: "SELECT status FROM orders WHERE id = ?", args: [orderId] });
    const prev = r.rows[0]?.status as OrderStatus | undefined;
    if (!prev || prev === status) {
      await tx.commit();
      return;
    }
    if (prev === "cancelado") throw new OrderError("Un pedido cancelado no se puede reabrir.");
    await tx.execute({ sql: "UPDATE orders SET status = ? WHERE id = ?", args: [status, orderId] });
    if (status === "cancelado") {
      const items = await tx.execute({
        sql: `SELECT oi.product_id, oi.qty FROM order_items oi JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = ? AND p.track_stock = 1`,
        args: [orderId],
      });
      for (const it of items.rows) {
        await tx.execute({ sql: "UPDATE products SET stock = stock + ? WHERE id = ?", args: [it.qty, it.product_id] });
        await tx.execute({
          sql: "INSERT INTO inventory_movements (item_type, item_id, change, reason, order_id) VALUES ('product', ?, ?, 'cancelacion', ?)",
          args: [it.product_id, it.qty, orderId],
        });
      }
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

export async function markOrderPaid(orderId: number) {
  const client = await db();
  await client.execute({
    sql: "UPDATE orders SET payment_status = 'pagado', paid_at = COALESCE(paid_at, ?) WHERE id = ? AND status != 'cancelado'",
    args: [new Date().toISOString(), orderId],
  });
}

export function orderCode(id: number) {
  return "#" + String(id).padStart(4, "0");
}
