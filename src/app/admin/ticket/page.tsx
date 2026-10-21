import { requireAdmin } from "@/lib/auth";
import { colsFor, ticketLines } from "@/lib/ticket";
import { ticketsByIds } from "@/lib/tickets-server";
import { SAMPLE_TICKET } from "@/lib/printer";
import AutoPrint from "./AutoPrint";

export const dynamic = "force-dynamic";

/** Ticket listo para imprimir con el diálogo del navegador (rollo de 58 u 80 mm). */
export default async function TicketPage({ searchParams }: PageProps<"/admin/ticket">) {
  await requireAdmin();
  const sp = await searchParams;
  const width = sp.w === "58" ? 58 : 80;
  const ids = String(sp.ids ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const tickets = sp.sample ? [SAMPLE_TICKET] : await ticketsByIds(ids);
  const cols = colsFor(width);
  const printable = width - 6; // mm útiles del rollo
  // Letra monoespaciada que hace caber exactamente `cols` caracteres en el ancho del rollo
  const fontMm = (printable / (cols * 0.61)).toFixed(3);

  return (
    <>
      <style>{`
        @page { size: ${width}mm auto; margin: 0; }
        html, body { background: #fff !important; margin: 0; }
        .ticket { width: ${printable}mm; margin: 0 auto; padding: 3mm 0; font: ${fontMm}mm/1.3 ui-monospace, Menlo, Consolas, "Courier New", monospace; color: #000; }
        .ticket div { white-space: pre; overflow: hidden; }
        .ticket .big { font-size: 2em; line-height: 1.15; }
        .ticket + .ticket { page-break-before: always; }
        @media screen { body { padding: 12px; } .ticket { box-shadow: 0 0 0 3mm #fff, 0 0 0 calc(3mm + 1px) #ddd; margin: 4mm auto; } }
      `}</style>
      {tickets.length === 0 && <p>No se encontró el pedido.</p>}
      {tickets.map((t) => (
        <div key={t.order.id} className="ticket">
          {ticketLines(t, cols).map((l, i) => (
            <div key={i} className={l.big ? "big" : undefined} style={{ textAlign: l.align ?? "left", fontWeight: l.bold ? 700 : 400 }}>
              {l.text || " "}
            </div>
          ))}
        </div>
      ))}
      {sp.auto && tickets.length > 0 && <AutoPrint />}
    </>
  );
}
