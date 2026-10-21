import { all } from "./db";
import { itemsForOrders } from "./orders";
import { getSettings } from "./settings";
import type { Order } from "./types";
import type { TicketData } from "./ticket";

export async function ticketsFor(orders: Order[]): Promise<TicketData[]> {
  const [items, s] = await Promise.all([itemsForOrders(orders.map((o) => o.id)), getSettings()]);
  const business = { name: s.business_name, address: s.address, phone: s.whatsapp_number };
  return orders.map((o) => ({
    business,
    order: o,
    items: (items.get(o.id) ?? []).map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, notes: i.notes })),
  }));
}

export async function ticketsByIds(ids: number[]): Promise<TicketData[]> {
  if (!ids.length) return [];
  const orders = await all<Order>(`SELECT * FROM orders WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids);
  return ticketsFor(orders);
}
