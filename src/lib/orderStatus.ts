import type { OrderStatus } from "./types";

/** Pasos que ve el cliente según cómo recibe su pedido. */
export function customerSteps(deliveryType: string): OrderStatus[] {
  return deliveryType === "domicilio"
    ? ["nuevo", "preparando", "en_camino", "entregado"]
    : ["nuevo", "preparando", "listo", "entregado"];
}

export const CUSTOMER_STATUS: Record<OrderStatus, { label: string; icon: string }> = {
  pago_pendiente: { label: "Esperando pago", icon: "💳" },
  nuevo: { label: "Recibido", icon: "📝" },
  preparando: { label: "Preparando", icon: "☕" },
  listo: { label: "Listo para recoger", icon: "🛍️" },
  en_camino: { label: "En camino", icon: "🛵" },
  entregado: { label: "Entregado", icon: "✅" },
  cancelado: { label: "Cancelado", icon: "✖" },
};
