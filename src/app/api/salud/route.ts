import { NextResponse } from "next/server";
import { dbKind, get } from "@/lib/db";
import { passwordConfigured } from "@/lib/auth";
import { stripeEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Diagnóstico rápido del despliegue. No expone secretos. */
export async function GET() {
  let database: string;
  try {
    const r = await get<{ n: number }>("SELECT COUNT(*) AS n FROM products");
    database = `ok (${r?.n} productos)`;
  } catch (e) {
    database = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  return NextResponse.json({
    database,
    databaseType: {
      postgres: "postgres (Neon)",
      "pglite-temporal": "temporal en /tmp (los datos se pierden)",
      pglite: "pglite local (data/pglite)",
    }[dbKind],
    adminPassword: passwordConfigured() ? "configurada" : "FALTA",
    stripe: stripeEnabled() ? "configurado" : "no configurado",
    vercelEnv: process.env.VERCEL_ENV ?? null,
    node: process.version,
  });
}
