import type { DeliveryRules, DeliveryZone } from "./delivery";
import { all, run } from "./db";

export type Settings = {
  business_name: string;
  whatsapp_number: string;
  delivery_enabled: boolean;
  delivery_fee: number;
  min_delivery_order: number;
  /** Envío gratis desde este subtotal (centavos). 0 = desactivado */
  free_delivery_from: number;
  store_open: boolean;
  address: string;
  hours: string;
};

export async function getSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    business_name: m.business_name ?? "Café",
    whatsapp_number: m.whatsapp_number ?? "",
    delivery_enabled: m.delivery_enabled === "1",
    delivery_fee: Number(m.delivery_fee ?? 0),
    min_delivery_order: Number(m.min_delivery_order ?? 0),
    free_delivery_from: Number(m.free_delivery_from ?? 0),
    store_open: m.store_open !== "0",
    address: m.address ?? "",
    hours: m.hours ?? "",
  };
}

export async function setSetting(key: string, value: string) {
  await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key,
    value,
  ]);
}

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function getDeliveryRules(): Promise<DeliveryRules> {
  const [s, zones] = await Promise.all([
    getSettings(),
    all<DeliveryZone>("SELECT id, name, postal_codes, fee FROM delivery_zones ORDER BY sort, fee, id"),
  ]);
  return { zones, flatFee: s.delivery_fee, freeFrom: s.free_delivery_from };
}
