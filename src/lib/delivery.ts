/** Cálculo del envío por código postal. Se usa en el servidor y en la tienda. */

export type DeliveryZone = { id: number; name: string; postal_codes: string; fee: number };

export type DeliveryRules = {
  zones: DeliveryZone[];
  /** Costo fijo cuando no hay zonas configuradas (centavos) */
  flatFee: number;
  /** Envío gratis desde este subtotal (centavos). 0 = no aplica */
  freeFrom: number;
};

export function normalizeCp(cp: string): string {
  return cp.replace(/\D/g, "").slice(0, 5);
}

export function parseCps(list: string): string[] {
  return [...new Set(list.split(/[\s,;]+/).map(normalizeCp).filter((c) => c.length === 5))];
}

export type DeliveryQuote =
  | { ok: true; fee: number; zone: string | null; free: boolean; baseFee: number }
  | { ok: false; reason: "cp_incompleto" | "sin_cobertura" };

export function quoteDelivery(rules: DeliveryRules, cpInput: string, subtotal: number): DeliveryQuote {
  let baseFee = rules.flatFee;
  let zone: string | null = null;
  if (rules.zones.length > 0) {
    const cp = normalizeCp(cpInput);
    if (cp.length !== 5) return { ok: false, reason: "cp_incompleto" };
    const found = rules.zones.find((z) => parseCps(z.postal_codes).includes(cp));
    if (!found) return { ok: false, reason: "sin_cobertura" };
    baseFee = found.fee;
    zone = found.name;
  }
  const free = rules.freeFrom > 0 && subtotal >= rules.freeFrom;
  return { ok: true, fee: free ? 0 : baseFee, zone, free, baseFee };
}
