/** Cálculo del envío por distancia (km por calle desde la cafetería). Se usa en el servidor y en la tienda. */

export type DeliveryRules = {
  /** Envío base (centavos): cubre los primeros `baseKm` */
  baseFee: number;
  baseKm: number;
  /** Cargo por cada km extra o fracción (centavos) */
  perKm: number;
  /** Distancia máxima de entrega en km. 0 = sin límite */
  maxKm: number;
  /** Envío gratis desde este subtotal (centavos). 0 = no aplica */
  freeFrom: number;
  /** ¿Hay servicio de mapas para medir la distancia? Sin él se cobra solo el envío base. */
  maps: boolean;
};

export type DeliveryQuote =
  | { ok: true; fee: number; baseFee: number; free: boolean }
  | { ok: false; reason: "muy_lejos" };

/** Costo del envío para una distancia (null = distancia desconocida, se cobra el envío base). */
export function feeForDistance(rules: DeliveryRules, km: number | null, subtotal: number): DeliveryQuote {
  if (km !== null && rules.maxKm > 0 && km > rules.maxKm) return { ok: false, reason: "muy_lejos" };
  const extraKm = km === null ? 0 : Math.max(0, Math.ceil(km - rules.baseKm - 1e-9));
  const baseFee = rules.baseFee + extraKm * rules.perKm;
  const free = rules.freeFrom > 0 && subtotal >= rules.freeFrom;
  return { ok: true, fee: free ? 0 : baseFee, baseFee, free };
}

/** Texto corto de la tarifa, p. ej. "$30 hasta 3 km + $5 por km extra (máx. 8 km)". */
export function tariffText(rules: DeliveryRules, money: (c: number) => string): string {
  if (!rules.maps) return rules.baseFee ? `${money(rules.baseFee)} a cualquier dirección` : "Gratis";
  const parts = [`${rules.baseFee ? money(rules.baseFee) : "Gratis"} hasta ${rules.baseKm} km`];
  if (rules.perKm) parts.push(`+ ${money(rules.perKm)} por km extra`);
  return parts.join(" ") + (rules.maxKm ? ` (entregamos hasta ${rules.maxKm} km)` : "");
}

export function normalizeCp(cp: string): string {
  return cp.replace(/\D/g, "").slice(0, 5);
}
