/** Cuentas de repartidores: entran con su teléfono y un PIN y solo ven los pedidos a domicilio. */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get, run } from "./db";
import { normalizePhone } from "./loyaltyRules";

export type Driver = {
  id: number;
  name: string;
  phone: string;
  active: number;
  session_version: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
};

const COOKIE = "cafe_driver";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export const validPin = (pin: string) => /^\d{6}$/.test(pin);

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

function checkPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function secret(): string {
  return `driver:${process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev"}`;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Valida teléfono + PIN. Bloquea la cuenta 15 min después de 5 intentos fallidos. */
export async function driverLogin(phoneInput: string, pin: string): Promise<Driver | string> {
  const phone = normalizePhone(phoneInput);
  const generic = "Teléfono o PIN incorrectos.";
  if (!phone || !validPin(pin)) return generic;
  const d = await get<Driver & { pin_hash: string }>("SELECT * FROM drivers WHERE phone = ?", [phone]);
  if (!d) {
    hashPin(pin); // mismo tiempo de respuesta exista o no la cuenta
    return generic;
  }
  if (d.locked_until && Date.parse(d.locked_until) > Date.now()) {
    return `Demasiados intentos. Espera ${LOCK_MINUTES} minutos o pide al administrador que te cambie el PIN.`;
  }
  if (!checkPin(pin, d.pin_hash)) {
    const fails = d.failed_attempts + 1;
    await run("UPDATE drivers SET failed_attempts = ?, locked_until = ? WHERE id = ?", [
      fails >= MAX_ATTEMPTS ? 0 : fails,
      fails >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
      d.id,
    ]);
    return generic;
  }
  if (!d.active) return "Tu cuenta está desactivada. Habla con el administrador.";
  await run("UPDATE drivers SET failed_attempts = 0, locked_until = NULL WHERE id = ?", [d.id]);
  return d;
}

export async function startDriverSession(d: Driver) {
  const payload = `${d.id}.${d.session_version}.${Date.now() + MAX_AGE * 1000}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endDriverSession() {
  (await cookies()).delete(COOKIE);
}

/** Repartidor con sesión válida (cuenta activa y sin cambio de PIN desde que entró). */
export async function currentDriver(): Promise<Driver | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  const parts = v.split(".");
  if (parts.length !== 4) return null;
  const [id, version, exp, sig] = parts;
  const expected = sign(`${id}.${version}.${exp}`);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  const d = await get<Driver>(
    "SELECT id, name, phone, active, session_version, failed_attempts, locked_until, created_at FROM drivers WHERE id = ?",
    [Number(id)],
  );
  if (!d || !d.active || d.session_version !== Number(version)) return null;
  return d;
}

/** Usar al inicio de cada página o acción del repartidor. */
export async function requireDriver(): Promise<Driver> {
  const d = await currentDriver();
  if (!d) redirect("/repartidor/login");
  return d;
}
