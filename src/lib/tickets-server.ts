import { all } from "./db";
import { itemsForOrders } from "./orders";
import { getSettings } from "./settings";
import { loyaltyStatus } from "./loyalty";
import type { Order } from "./types";
import type { TicketData } from "./ticket";

export async function ticketsFor(orders: Order[]): Promise<TicketData[]> {
  const [items, s] = await Promise.all([itemsForOrders(orders.map((o) => o.id)), getSettings()]);
  const business = { name: s.business_name, address: s.address, phone: s.whatsapp_number };
  const loyalty = await Promise.all(
    orders.map((o) => (o.phone && o.payment_status === "pagado" ? loyaltyStatus(o.phone).catch(() => null) : null)),
  );
  return orders.map((o, k) => {
    const l = loyalty[k];
    return {
      business,
      order: o,
      items: (items.get(o.id) ?? []).map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, notes: i.notes })),
      loyalty: l
        ? `Sellos: ${Math.min(l.stamps, l.needed)}/${l.needed}${l.rewards.length ? ` · ${l.rewards.length} bebida(s) gratis` : ""}`
        : undefined,
    };
  });
}

export async function ticketsByIds(ids: number[]): Promise<TicketData[]> {
  if (!ids.length) return [];
  const orders = await all<Order>(`SELECT * FROM orders WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`, ids);
  return ticketsFor(orders);
}
