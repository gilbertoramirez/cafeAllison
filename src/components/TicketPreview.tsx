import { colsFor, ticketLines, type TicketData } from "@/lib/ticket";

/**
 * Ticket dibujado igual que en la impresora térmica (mismas columnas).
 * Sirve para la vista previa en pantalla y para imprimir con el navegador.
 */
export default function TicketPreview({ data, width }: { data: TicketData; width: 58 | 80 }) {
  const cols = colsFor(width);
  const printable = width - 6; // mm útiles del rollo
  // Letra monoespaciada que hace caber exactamente `cols` caracteres en el ancho del rollo
  const fontMm = (printable / (cols * 0.61)).toFixed(3);
  return (
    <div
      className="ticket-paper"
      style={{
        width: `${printable}mm`,
        maxWidth: "100%",
        font: `${fontMm}mm/1.3 ui-monospace, Menlo, Consolas, "Courier New", monospace`,
        color: "#000",
      }}
    >
      {ticketLines(data, cols).map((l, i) => (
        <div
          key={i}
          style={{
            whiteSpace: "pre",
            overflow: "hidden",
            textAlign: l.align ?? "left",
            fontWeight: l.bold ? 700 : 400,
            fontSize: l.big ? "2em" : undefined,
            lineHeight: l.big ? 1.15 : undefined,
          }}
        >
          {l.text || " "}
        </div>
      ))}
    </div>
  );
}
