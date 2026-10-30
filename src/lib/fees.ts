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
