/** Reglas del programa de lealtad que comparten la tienda, la caja y el servidor. */

export type LoyaltySettings = {
  enabled: boolean;
  /** sellos para ganar la bebida */
  needed: number;
  /** compra mínima (centavos) para ganar sello */
  minPurchase: number;
  /** meses que dura cada sello */
  stampMonths: number;
  /** días para canjear la bebida ganada */
  rewardDays: number;
};

export type LoyaltyStatus = {
  stamps: number;
  needed: number;
  rewards: { id: number; expires_at: string }[];
};

const DRINK_CATEGORIES = ["Bebidas Calientes", "Calientes Sin Café", "Bebidas Frías", "Café", "Sin Café", "Barra Fría"];

/** Bebida gratis: bebidas de hasta 12oz (excluye frappés especiales y malteadas). */
export function isFreeDrinkEligible(p: { category: string; size: string }) {
  if (!DRINK_CATEGORIES.includes(p.category)) return false;
  const oz = /(\d+)\s*oz/i.exec(p.size)?.[1];
  return !oz || Number(oz) <= 12;
}

/** Línea del pedido de la que se regala 1 unidad: la bebida elegible más cara. -1 si no hay. */
export function pickFreeLine(lines: { category: string; size: string; price: number }[]): number {
  let best = -1;
  lines.forEach((l, i) => {
    if (isFreeDrinkEligible(l) && (best < 0 || l.price > lines[best].price)) best = i;
  });
  return best;
}

export function normalizePhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export const FREE_NOTE = "🎁 Bebida gratis (lealtad)";
