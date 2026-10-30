import { createHash, randomInt } from "node:crypto";
import { all, get, run, transaction, type Query } from "./db";
import { addMonths, localDate } from "./format";
import { normalizePhone, type LoyaltySettings, type LoyaltyStatus } from "./loyaltyRules";
import { getSettings } from "./settings";
import { sendMessage, smsEnabled } from "./sms";

const nowIso = () => new Date().toISOString();

export async function loyaltySettings(): Promise<LoyaltySettings> {
  return (await getSettings()).loyalty;
}

/** Sellos vigentes y bebidas gratis disponibles de un teléfono. */
export async function loyaltyStatus(phoneInput: string): Promise<LoyaltyStatus | null> {
  const phone = normalizePhone(phoneInput);
  const cfg = await loyaltySettings();
  if (!phone || !cfg.enabled) return null;
  const now = nowIso();
  await run("UPDATE loyalty_rewards SET status = 'vencido' WHERE phone = ? AND status = 'disponible' AND expires_at <= ?", [
    phone,
    now,
  ]);
  const [{ n }] = await all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM loyalty_stamps WHERE phone = ? AND reward_id IS NULL AND expires_at > ?",
    [phone, now],
  );
  const rewards = await all<{ id: number; expires_at: string }>(
    "SELECT id, expires_at FROM loyalty_rewards WHERE phone = ? AND status = 'disponible' ORDER BY expires_at",
    [phone],
  );
  return { stamps: n, needed: cfg.needed, rewards };
}

/**
 * Da un sello por un pedido pagado (máximo 1 por día y teléfono, compra mínima configurable).
 * Idempotente. Al juntar los sellos necesarios crea la bebida gratis.
 */
export async function awardStamp(orderId: number) {
  const cfg = await loyaltySettings();
  if (!cfg.enabled) return;
  const order = await get<{ phone: string; subtotal: number; payment_status: string; status: string }>(
    "SELECT phone, subtotal, payment_status, status FROM orders WHERE id = ?",
    [orderId],
  );
  const phone = normalizePhone(order?.phone ?? "");
  if (!order || !phone || order.payment_status !== "pagado" || order.status === "cancelado") return;
  if (order.subtotal < cfg.minPurchase) return;
  const today = localDate();
  const expires = new Date(addMonths(today, cfg.stampMonths) + "T23:59:59Z").toISOString();
  await transaction(async (q) => {
    await q(
      `INSERT INTO loyalty_stamps (phone, order_id, stamp_date, expires_at) VALUES (?,?,?,?)
       ON CONFLICT DO NOTHING`,
      [phone, orderId, today, expires],
    );
    await maybeCreateReward(q, phone, cfg);
  });
}

async function maybeCreateReward(q: Query, phone: string, cfg: LoyaltySettings) {
  const now = nowIso();
  const stamps = await q<{ id: number }>(
    "SELECT id FROM loyalty_stamps WHERE phone = ? AND reward_id IS NULL AND expires_at > ? ORDER BY stamp_date LIMIT ? FOR UPDATE",
    [phone, now, cfg.needed],
  );
  if (stamps.length < cfg.needed) return;
  const expires = new Date(Date.now() + cfg.rewardDays * 86400_000).toISOString();
  const [r] = await q<{ id: number }>(
    "INSERT INTO loyalty_rewards (phone, earned_at, expires_at) VALUES (?,?,?) RETURNING id",
    [phone, now, expires],
  );
  await q(`UPDATE loyalty_stamps SET reward_id = ? WHERE id IN (${stamps.map(() => "?").join(",")})`, [
    r.id,
    ...stamps.map((s) => s.id),
  ]);
}

/**
 * Al cancelar un pedido: quita su sello (si ese sello ya formó una bebida no canjeada, la anula)
 * y devuelve la bebida gratis si el pedido la había usado.
 */
export async function revokeLoyaltyForOrder(q: Query, orderId: number) {
  const [stamp] = await q<{ id: number; reward_id: number | null }>(
    "SELECT id, reward_id FROM loyalty_stamps WHERE order_id = ?",
    [orderId],
  );
  if (stamp) {
    if (stamp.reward_id) {
      const [rw] = await q<{ status: string }>("SELECT status FROM loyalty_rewards WHERE id = ?", [stamp.reward_id]);
      if (rw?.status === "disponible") {
        await q("UPDATE loyalty_rewards SET status = 'anulado' WHERE id = ?", [stamp.reward_id]);
        await q("UPDATE loyalty_stamps SET reward_id = NULL WHERE reward_id = ?", [stamp.reward_id]);
        await q("DELETE FROM loyalty_stamps WHERE id = ?", [stamp.id]);
      }
      // si la bebida ya se canjeó, el sello se queda (no se puede deshacer)
    } else {
      await q("DELETE FROM loyalty_stamps WHERE id = ?", [stamp.id]);
    }
  }
  await q(
    `UPDATE loyalty_rewards SET status = CASE WHEN expires_at > ? THEN 'disponible' ELSE 'vencido' END,
            redeemed_order_id = NULL, redeemed_at = NULL
     WHERE redeemed_order_id = ? AND status = 'canjeado'`,
    [nowIso(), orderId],
  );
}

/** Toma (bloquea) una bebida gratis disponible del teléfono, o null. */
export async function claimRewardForUpdate(q: Query, phone: string) {
  const [r] = await q<{ id: number }>(
    "SELECT id FROM loyalty_rewards WHERE phone = ? AND status = 'disponible' AND expires_at > ? ORDER BY expires_at LIMIT 1 FOR UPDATE",
    [phone, nowIso()],
  );
  return r ?? null;
}

// ---------- Código de verificación para canjear en línea ----------

const hash = (phone: string, code: string) =>
  createHash("sha256").update(`${phone}:${code}:${process.env.SESSION_SECRET ?? "cafe"}`).digest("hex");

/** Envía un código de 6 dígitos al teléfono. En desarrollo, sin Twilio, lo devuelve para pruebas. */
export async function sendRedeemCode(phoneInput: string): Promise<{ devCode?: string }> {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error("Escribe tu teléfono de 10 dígitos.");
  const devMode = !smsEnabled() && process.env.NODE_ENV !== "production";
  if (!smsEnabled() && !devMode) throw new Error("Por ahora canjea tu bebida gratis en la caja.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  await run(
    `INSERT INTO loyalty_codes (phone, code_hash, expires_at, attempts) VALUES (?,?,?,0)
     ON CONFLICT (phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    [phone, hash(phone, code), expires],
  );
  if (devMode) {
    console.log(`[lealtad] código para ${phone}: ${code}`);
    return { devCode: code };
  }
  await sendMessage(phone, `Café Allison: tu código para canjear tu bebida gratis es ${code}. Vence en 10 minutos.`);
  return {};
}

/** Verifica el código (máximo 5 intentos). Se consume al acertar. */
export async function verifyRedeemCode(phoneInput: string, code: string): Promise<boolean> {
  const phone = normalizePhone(phoneInput);
  const row = await get<{ code_hash: string; expires_at: string; attempts: number }>(
    "SELECT code_hash, expires_at, attempts FROM loyalty_codes WHERE phone = ?",
    [phone],
  );
  if (!row || row.expires_at <= nowIso() || row.attempts >= 5) return false;
  if (row.code_hash !== hash(phone, code.trim())) {
    await run("UPDATE loyalty_codes SET attempts = attempts + 1 WHERE phone = ?", [phone]);
    return false;
  }
  await run("DELETE FROM loyalty_codes WHERE phone = ?", [phone]);
  return true;
}
