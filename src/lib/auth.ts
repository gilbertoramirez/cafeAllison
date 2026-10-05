import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "cafe_admin";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 días

function adminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD?.trim();
  if (p) return p;
  // Solo en desarrollo hay contraseña por defecto
  return process.env.NODE_ENV === "production" ? null : "admin";
}

function secret(): string {
  return process.env.SESSION_SECRET || `cafe:${adminPassword() ?? ""}`;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function passwordConfigured(): boolean {
  return adminPassword() !== null;
}

export function checkPassword(input: string): boolean {
  const p = adminPassword();
  return p !== null && safeEqual(input.trim(), p);
}

export async function startSession() {
  const exp = String(Date.now() + MAX_AGE * 1000);
  (await cookies()).set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || !safeEqual(sig, sign(exp))) return false;
  return Number(exp) > Date.now();
}

/** Usar al inicio de cada página o Server Action del panel. */
export async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin/login");
}
