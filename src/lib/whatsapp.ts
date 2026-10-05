import { money, waNumber } from "./format";
import { orderCode } from "./orders";
import type { Order, OrderItem } from "./types";
import { ORDER_STATUS_LABEL } from "./types";

export function waLink(phone: string, text: string) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

/** Mensaje que el cliente envía al negocio. */
export function orderMessage(order: Order, items: OrderItem[], trackUrl: string) {
  const lines = [
    `¡Hola! Quiero hacer este pedido (${orderCode(order.id)}):`,
    "",
    ...items.map((i) => `• ${i.qty} × ${i.name} — ${money(i.unit_price * i.qty)}`),
    "",
    order.delivery_fee ? `Envío: ${money(order.delivery_fee)}` : null,
    `*Total: ${money(order.total)}*`,
    "",
    `Nombre: ${order.customer_name}`,
    order.delivery_type === "domicilio" ? `Entregar en: ${order.address}` : "Paso a recogerlo",
    order.address_ref ? `Referencias: ${order.address_ref}` : null,
    order.lat != null ? `Ubicación: https://maps.google.com/?q=${order.lat},${order.lng}` : null,
    order.notes ? `Notas: ${order.notes}` : null,
    "",
    `Seguimiento: ${trackUrl}`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** Mensaje que el negocio envía al cliente para avisar el estado. */
export function statusMessage(order: Order, businessName: string, trackUrl: string) {
  const status = ORDER_STATUS_LABEL[order.status];
  return [
    `Hola ${order.customer_name || ""} 👋, te escribimos de ${businessName}.`,
    `Tu pedido ${orderCode(order.id)} está: *${status}*.`,
    `Total: ${money(order.total)}${order.payment_status === "pagado" ? " (pagado)" : ""}`,
    `Puedes verlo aquí: ${trackUrl}`,
  ].join("\n");
}
