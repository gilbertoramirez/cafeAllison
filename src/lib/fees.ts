/**
 * Comisión por pago en línea (Stripe) trasladada al cliente.
 * Se calcula "hacia atrás" para que, después de la comisión de Stripe (porcentaje + fijo, más IVA
 * sobre la comisión), al negocio le llegue completo el importe del pedido.
 */
export type OnlineFeeRules = {
  enabled: boolean;
  /** porcentaje de Stripe, p. ej. 3.6 */
  percent: number;
  /** cargo fijo por pago en centavos, p. ej. 300 = $3 */
  fixed: number;
  /** IVA sobre la comisión, p. ej. 16 */
  iva: number;
};

/** Centavos que se suman al pedido para cubrir la comisión. */
export function onlineFee(amount: number, r: OnlineFeeRules): number {
  if (!r.enabled || amount <= 0) return 0;
  const tax = 1 + Math.max(0, r.iva) / 100;
  const pct = (Math.max(0, r.percent) / 100) * tax;
  if (pct >= 1) return 0;
  const charge = Math.ceil((amount + Math.max(0, r.fixed) * tax) / (1 - pct));
  return charge - amount;
}

/**
 * Precio para la tienda en línea con el porcentaje de la comisión ya incluido,
 * redondeado hacia arriba al peso. El cargo fijo por cobro se cubre a nivel pedido.
 */
export function onlinePrice(price: number, r: OnlineFeeRules): number {
  if (!r.enabled || price <= 0) return price;
  const pct = (Math.max(0, r.percent) / 100) * (1 + Math.max(0, r.iva) / 100);
  if (pct >= 1) return price;
  return Math.ceil(price / (1 - pct) / 100) * 100;
}

/** Comisión estimada que Stripe descuenta de un cobro (centavos). */
export function processorFee(charge: number, r: OnlineFeeRules): number {
  if (charge <= 0) return 0;
  return Math.round(((charge * Math.max(0, r.percent)) / 100 + Math.max(0, r.fixed)) * (1 + Math.max(0, r.iva) / 100));
}

/**
 * Precios para un pago con tarjeta en línea. Productos y envío cuestan lo mismo que en efectivo
 * (cada producto ya lleva el porcentaje de la comisión). Si eso no cubre el cargo fijo de Stripe
 * por cobro, la diferencia (redondeada al peso) va en un renglón aparte: "Cargo por pago con tarjeta".
 * Se usa igual en la tienda y en el servidor.
 */
export function cardPricing(
  lines: { price: number; qty: number }[],
  delivery: number,
  r: OnlineFeeRules,
): { prices: number[]; delivery: number; cardFee: number } {
  if (!r.enabled) return { prices: lines.map((l) => l.price), delivery, cardFee: 0 };
  const prices = lines.map((l) => onlinePrice(l.price, r));
  const base = lines.reduce((a, l) => a + l.price * l.qty, 0) + delivery;
  const charged = prices.reduce((a, p, i) => a + p * lines[i].qty, 0) + delivery;
  const residual = base + onlineFee(base, r) - charged;
  if (residual <= 0 || !lines.length) return { prices, delivery, cardFee: 0 };
  return { prices, delivery, cardFee: Math.ceil(residual / 100) * 100 };
}
