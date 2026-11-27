import { revalidatePath } from "next/cache";
import { applyDuePriceChanges } from "@/lib/priceChanges";

export const dynamic = "force-dynamic";

/**
 * Tarea diaria de Vercel (vercel.json → crons): aplica los cambios de precio que ya tocan.
 * Si existe la variable CRON_SECRET, Vercel manda "Authorization: Bearer <CRON_SECRET>" y aquí se verifica.
 * Sin ella también es seguro: solo aplica lo que ya estaba programado y su fecha ya llegó.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("No autorizado", { status: 401 });
  const applied = await applyDuePriceChanges();
  if (applied) revalidatePath("/", "layout");
  return Response.json({ applied });
}
