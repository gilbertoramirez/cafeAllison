import type { DeliveryRules } from "./delivery";
import type { OnlineFeeRules } from "./fees";
import type { LoyaltySettings } from "./loyaltyRules";
import type { NtfySettings } from "./notify";
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
  /** Comisión por pago en línea trasladada al cliente */
  online_fee: OnlineFeeRules;
  loyalty: LoyaltySettings;
  /** Envío por distancia: km incluidos en el envío base, cargo por km extra y distancia máxima */
  delivery_base_km: number;
  delivery_per_km: number;
  delivery_max_km: number;
  /** Ubicación exacta de la cafetería (punto de salida de los envíos) */
  cafe_location: { lat: number; lng: number } | null;
  /** La ubicación se fijó a mano (no se borra al cambiar la dirección) */
  cafe_location_manual: boolean;
  /** Avisos al celular con ntfy */
  ntfy: NtfySettings;
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
    online_fee: {
      enabled: m.online_fee_enabled === "1",
      percent: Number(m.online_fee_percent ?? 3.6),
      fixed: Number(m.online_fee_fixed ?? 300),
      iva: Number(m.online_fee_iva ?? 16),
    },
    loyalty: {
      enabled: m.loyalty_enabled !== "0",
      needed: Math.max(1, Number(m.loyalty_stamps_needed ?? 10)),
      minPurchase: Number(m.loyalty_min_purchase ?? 5000),
      stampMonths: Math.max(1, Number(m.loyalty_stamp_months ?? 6)),
      rewardDays: Math.max(1, Number(m.loyalty_reward_days ?? 30)),
    },
    delivery_base_km: Math.max(0, Number(m.delivery_base_km ?? 3)),
    delivery_per_km: Math.max(0, Number(m.delivery_per_km ?? 500)),
    delivery_max_km: Math.max(0, Number(m.delivery_max_km ?? 8)),
    cafe_location:
      m.cafe_lat && m.cafe_lng && Number.isFinite(Number(m.cafe_lat)) && Number.isFinite(Number(m.cafe_lng))
        ? { lat: Number(m.cafe_lat), lng: Number(m.cafe_lng) }
        : null,
    cafe_location_manual: m.cafe_location_manual === "1",
    ntfy: {
      server: m.ntfy_server || "https://ntfy.sh",
      topic: m.ntfy_topic ?? "",
      newOrders: m.ntfy_new !== "0",
      updates: m.ntfy_updates !== "0",
      pos: m.ntfy_pos === "1",
    },
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
  const s = await getSettings();
  return {
    baseFee: s.delivery_fee,
    baseKm: s.delivery_base_km,
    perKm: s.delivery_per_km,
    maxKm: s.delivery_max_km,
    freeFrom: s.free_delivery_from,
    maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
  };
}
