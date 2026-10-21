import { isAdmin } from "@/lib/auth";
import { get } from "@/lib/db";
import { liveResponse } from "@/lib/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cambios en cualquier pedido, para el panel de administración. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return new Response("No autorizado", { status: 401 });
  return liveResponse(req, async () => {
    const row = await get<{ v: number; online: number; pending: number; last_online: number }>(
      `SELECT COALESCE(MAX(change_seq), 0) AS v,
              COUNT(*) FILTER (WHERE channel <> 'mostrador') AS online,
              COUNT(*) FILTER (WHERE channel <> 'mostrador' AND status NOT IN ('entregado','cancelado')) AS pending,
              COALESCE(MAX(id) FILTER (WHERE channel <> 'mostrador'), 0) AS last_online
       FROM orders`,
    );
    return { v: row?.v ?? 0, online: row?.online ?? 0, pending: row?.pending ?? 0, lastOnline: row?.last_online ?? 0 };
  });
}
