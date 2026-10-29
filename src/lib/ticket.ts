/**
 * Contenido del ticket (texto de ancho fijo) y su conversión a comandos ESC/POS
 * para impresoras térmicas de 58 mm (32 columnas) u 80 mm (48 columnas).
 * Se usa en el navegador; no depende del servidor.
 */
import { dateTime, money } from "./format";

export type TicketData = {
  business: { name: string; address: string; phone: string };
  order: {
    id: number;
    channel: string;
    status: string;
    customer_name: string;
    phone: string;
    delivery_type: string;
    address: string;
    address_ref: string;
    postal_code: string;
    notes: string;
    payment_method: string;
    payment_status: string;
    cash_given: number | null;
    subtotal: number;
    delivery_fee: number;
    total: number;
    created_at: string;
  };
  items: { name: string; qty: number; unit_price: number; notes: string }[];
};

export type TicketLine = { text: string; align?: "left" | "center" | "right"; bold?: boolean; big?: boolean };

const PAYMENT: Record<string, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  stripe: "Pago en línea",
  whatsapp: "Acordado por WhatsApp",
};
const CHANNEL: Record<string, string> = { mostrador: "Mostrador", web: "En línea", whatsapp: "WhatsApp" };

export function colsFor(width: 58 | 80) {
  return width === 58 ? 32 : 48;
}

function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + " " + word).length <= cols) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > cols) {
        out.push(line.slice(0, cols));
        line = line.slice(cols);
      }
    }
    out.push(line);
  }
  return out;
}

/** "Texto ........ $10.00" ajustado al ancho */
function row(left: string, right: string, cols: number): string[] {
  const lines = wrap(left, Math.max(8, cols - right.length - 1));
  const last = lines.pop() ?? "";
  return [...lines, last + " ".repeat(Math.max(1, cols - last.length - right.length)) + right];
}

export function ticketLines(d: TicketData, cols: number): TicketLine[] {
  const o = d.order;
  const L: TicketLine[] = [];
  const sep = (ch = "-") => L.push({ text: ch.repeat(cols) });
  const add = (text: string, opt: Omit<TicketLine, "text"> = {}) => wrap(text, opt.big ? Math.floor(cols / 2) : cols).forEach((t) => L.push({ text: t, ...opt }));

  add(d.business.name, { align: "center", big: true, bold: true });
  if (d.business.address) add(d.business.address, { align: "center" });
  if (d.business.phone) add(`Tel. ${d.business.phone}`, { align: "center" });
  sep("=");
  add(`PEDIDO #${String(o.id).padStart(4, "0")}`, { align: "center", big: true, bold: true });
  add(dateTime(o.created_at), { align: "center" });
  add(
    o.channel === "mostrador"
      ? "Venta en mostrador"
      : `${CHANNEL[o.channel] ?? o.channel} · ${o.delivery_type === "domicilio" ? "A DOMICILIO" : "PARA RECOGER"}`,
    { align: "center", bold: true },
  );
  if (o.status === "cancelado") add("*** CANCELADO ***", { align: "center", bold: true, big: true });
  if (o.customer_name) add(`Cliente: ${o.customer_name}`);
  if (o.phone) add(`Tel: ${o.phone}`);
  sep();

  for (const it of d.items) {
    row(`${it.qty} x ${it.name}`, money(it.unit_price * it.qty), cols).forEach((t) => L.push({ text: t, bold: true }));
    if (it.notes) wrap(`  > ${it.notes}`, cols).forEach((t) => L.push({ text: t }));
  }
  sep();
  row("Subtotal", money(o.subtotal), cols).forEach((t) => L.push({ text: t }));
  if (o.delivery_type === "domicilio") {
    row("Envío", o.delivery_fee ? money(o.delivery_fee) : "Gratis", cols).forEach((t) => L.push({ text: t }));
  }
  row("TOTAL", money(o.total), Math.floor(cols / 2)).forEach((t) => L.push({ text: t, bold: true, big: true }));
  add(`Pago: ${PAYMENT[o.payment_method] ?? o.payment_method} · ${o.payment_status === "pagado" ? "PAGADO" : "POR COBRAR"}`);
  if (o.cash_given) {
    row("Efectivo recibido", money(o.cash_given), cols).forEach((t) => L.push({ text: t }));
    row("Cambio", money(o.cash_given - o.total), cols).forEach((t) => L.push({ text: t, bold: true }));
  }

  if (o.delivery_type === "domicilio") {
    sep();
    add("ENTREGAR EN:", { bold: true });
    add(o.address + (o.postal_code ? `, CP ${o.postal_code}` : ""));
    if (o.address_ref) add(`Ref: ${o.address_ref}`);
  }
  if (o.notes) {
    sep();
    add(`NOTAS: ${o.notes}`, { bold: true });
  }
  sep("=");
  add("¡Gracias por tu compra!", { align: "center" });
  return L;
}

// ---------- ESC/POS ----------

// Página de códigos PC850 (Latin-1): acentos y ñ en la mayoría de impresoras térmicas
const PC850: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, "¿": 0xa8, "¡": 0xad, "°": 0xf8,
};

function encodeText(s: string, accents: boolean): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code < 127) out.push(code);
    else if (accents && PC850[ch] !== undefined) out.push(PC850[ch]);
    else {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (plain.length === 1 && plain.charCodeAt(0) < 127) out.push(plain.charCodeAt(0));
      else if (ch === "·") out.push(accents ? 0xfa : 0x2d);
      else if (ch === "¿" || ch === "¡") continue;
      // emojis y otros símbolos se omiten
    }
  }
  return out;
}

export function escpos(
  lines: TicketLine[],
  opts: { cut?: boolean; drawer?: boolean; copies?: number; accents?: boolean } = {},
): Uint8Array {
  const ESC = 0x1b;
  const GS = 0x1d;
  const FS = 0x1c;
  const accents = opts.accents !== false;
  const bytes: number[] = [];
  for (let c = 0; c < Math.max(1, opts.copies ?? 1); c++) {
    bytes.push(ESC, 0x40); // inicializar
    bytes.push(FS, 0x2e); // salir del modo de caracteres chinos (impresoras genéricas lo traen activado)
    bytes.push(ESC, 0x74, 2); // página de códigos PC850
    for (const l of lines) {
      bytes.push(ESC, 0x61, l.align === "center" ? 1 : l.align === "right" ? 2 : 0);
      bytes.push(ESC, 0x45, l.bold ? 1 : 0);
      bytes.push(GS, 0x21, l.big ? 0x11 : 0x00);
      bytes.push(...encodeText(l.text, accents), 0x0a);
    }
    bytes.push(ESC, 0x61, 0, GS, 0x21, 0, ESC, 0x45, 0);
    bytes.push(0x0a, 0x0a, 0x0a);
    if (opts.cut !== false) bytes.push(GS, 0x56, 0x42, 0x00); // avanzar y cortar
  }
  if (opts.drawer) bytes.push(...DRAWER_KICK);
  return Uint8Array.from(bytes);
}

/** Pulso al conector RJ11 de la impresora para abrir el cajón de dinero. */
const DRAWER_KICK = [0x1b, 0x70, 0, 25, 250];
export function drawerBytes(): Uint8Array {
  return Uint8Array.from([0x1b, 0x40, ...DRAWER_KICK]);
}
