import { get } from "@/lib/db";
import { liveResponse } from "@/lib/live";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cambios de un pedido, para la página de seguimiento del cliente. */
export async function GET(req: Request, ctx: RouteContext<"/api/live/pedido/[token]">) {
  const { token } = await ctx.params;
  const exists = await get<{ id: number }>("SELECT id FROM orders WHERE token = ?", [token]);
  if (!exists) return new Response("No encontrado", { status: 404 });
  return liveResponse(req, async () => {
    const row = await get<{ v: number; status: string; payment_status: string }>(
      "SELECT change_seq AS v, status, payment_status FROM orders WHERE token = ?",
      [token],
    );
    return { v: row?.v ?? 0, status: row?.status, payment: row?.payment_status };
  });
}
