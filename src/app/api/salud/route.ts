import { NextResponse } from "next/server";
import { db, isEphemeralDb, url } from "@/lib/db";
import { passwordConfigured } from "@/lib/auth";
import { stripeEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Diagnóstico rápido del despliegue. No expone secretos. */
export async function GET() {
  let database: string;
  try {
    const client = await db();
    const r = await client.execute("SELECT COUNT(*) AS n FROM products");
    database = `ok (${r.rows[0].n} productos)`;
  } catch (e) {
    database = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return NextResponse.json({
    database,
    databaseType: url.startsWith("file:") ? (isEphemeralDb ? "sqlite temporal (/tmp)" : "sqlite archivo") : "turso/libsql",
    adminPassword: passwordConfigured() ? "configurada" : "FALTA",
    stripe: stripeEnabled() ? "configurado" : "no configurado",
    vercelEnv: process.env.VERCEL_ENV ?? null,
    node: process.version,
  });
}
