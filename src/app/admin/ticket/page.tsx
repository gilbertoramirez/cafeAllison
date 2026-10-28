import { requireAdmin } from "@/lib/auth";
import { ticketsByIds } from "@/lib/tickets-server";
import { SAMPLE_TICKET } from "@/lib/printer";
import AutoPrint from "./AutoPrint";
import TicketPreview from "@/components/TicketPreview";

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
  return (
    <>
      <style>{`
        @page { size: ${width}mm auto; margin: 0; }
        html, body { background: #fff !important; margin: 0; }
        .ticket { margin: 0 auto; padding: 3mm 0; width: ${width - 6}mm; }
        .ticket + .ticket { page-break-before: always; }
        @media screen { body { padding: 12px; } .ticket { box-shadow: 0 0 0 3mm #fff, 0 0 0 calc(3mm + 1px) #ddd; margin: 4mm auto; } }
      `}</style>
      {tickets.length === 0 && <p>No se encontró el pedido.</p>}
      {tickets.map((t) => (
        <div key={t.order.id} className="ticket">
          <TicketPreview data={t} width={width} />
        </div>
      ))}
      {sp.auto && tickets.length > 0 && <AutoPrint />}
    </>
  );
}
