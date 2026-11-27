import { isAdmin } from "@/lib/auth";
import { rangeFor } from "@/lib/finance";
import { buildSalesWorkbook } from "@/lib/salesExport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isDay = (s: string | null): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)));

/** Descarga las ventas en Excel: ?periodo=mes | ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD */
export async function GET(req: Request) {
  if (!(await isAdmin())) return new Response("No autorizado", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const desde = sp.get("desde");
  const hasta = sp.get("hasta");
  let range: { from: string; to: string };
  if (isDay(desde) && isDay(hasta)) {
    range = desde <= hasta ? { from: desde, to: hasta } : { from: hasta, to: desde };
  } else {
    range = rangeFor(sp.get("periodo") ?? "mes");
  }
  const file = await buildSalesWorkbook(range);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ventas_${range.from}_a_${range.to}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}
