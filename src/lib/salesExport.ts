/** Exporta las ventas de un periodo a un archivo de Excel (.xlsx). */
import ExcelJS from "exceljs";
import { all } from "./db";
import { addDays, localDate, startOfLocalDay, time } from "./format";
import { orderCode } from "./orders";
import { ORDER_STATUS_LABEL, PAYMENT_LABEL, type OrderStatus, type PaymentMethod } from "./types";

type Range = { from: string; to: string };

type OrderRow = {
  id: number;
  created_at: string;
  channel: string;
  delivery_type: string;
  customer_name: string;
  phone: string;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  processing_fee: number;
  total: number;
  cancel_reason: string;
  cost: number;
};

type ItemRow = {
  order_id: number;
  created_at: string;
  name: string;
  notes: string;
  qty: number;
  unit_price: number;
  unit_cost: number;
};

const CHANNEL: Record<string, string> = { mostrador: "Caja", web: "En línea", whatsapp: "WhatsApp" };
const DELIVERY: Record<string, string> = { mostrador: "En el local", recoger: "Para recoger", domicilio: "A domicilio" };
const MONEY = '"$"#,##0.00';
const pesos = (cents: number) => Math.round(Number(cents)) / 100;
/** Cuenta como venta: pagada y no cancelada (misma regla que Finanzas). */
const counts = (o: { payment_status: string; status: string }) => o.payment_status === "pagado" && o.status !== "cancelado";

/** Fecha de Excel (sin hora) a partir del día local "YYYY-MM-DD". */
function excelDate(iso: string): Date {
  const [y, m, d] = localDate(new Date(iso)).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B2A20" } };
  row.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function totalsRow(ws: ExcelJS.Worksheet, label: string, sumKeys: string[]) {
  const last = ws.rowCount;
  if (last < 2) return;
  const values: Record<string, unknown> = { [ws.columns[0].key as string]: label };
  for (const k of sumKeys) {
    const col = ws.getColumn(k).letter;
    values[k] = { formula: `SUBTOTAL(9,${col}2:${col}${last})` };
  }
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.border = { top: { style: "thin" } };
}

export async function buildSalesWorkbook(r: Range): Promise<Buffer> {
  const a = startOfLocalDay(r.from);
  const b = startOfLocalDay(addDays(r.to, 1));
  const [orders, items] = await Promise.all([
    all<OrderRow>(
      `SELECT o.id, o.created_at, o.channel, o.delivery_type, o.customer_name, o.phone, o.status, o.payment_method,
              o.payment_status, o.subtotal, o.delivery_fee, o.service_fee, o.processing_fee, o.total, o.cancel_reason,
              COALESCE((SELECT SUM(oi.unit_cost * oi.qty) FROM order_items oi WHERE oi.order_id = o.id), 0) AS cost
       FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status <> 'pago_pendiente'
       ORDER BY o.created_at`,
      [a, b],
    ),
    all<ItemRow>(
      `SELECT oi.order_id, o.created_at, oi.name, oi.notes, oi.qty, oi.unit_price, oi.unit_cost
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at >= ? AND o.created_at < ? AND o.payment_status = 'pagado' AND o.status <> 'cancelado'
       ORDER BY o.created_at, oi.id`,
      [a, b],
    ),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Café";
  wb.created = new Date();

  // ---- Hoja 1: Resumen ----
  const sold = orders.filter(counts);
  const net = (o: OrderRow) => Number(o.total) - Number(o.processing_fee);
  const sales = sold.reduce((s, o) => s + net(o), 0);
  const cost = sold.reduce((s, o) => s + Number(o.cost), 0);
  const summary = wb.addWorksheet("Resumen");
  summary.columns = [
    { key: "k", width: 34 },
    { key: "v", width: 18 },
    { key: "n", width: 12 },
  ];
  const head = summary.addRow([`Ventas del ${r.from.split("-").reverse().join("/")} al ${r.to.split("-").reverse().join("/")}`]);
  head.font = { bold: true, size: 14 };
  summary.addRow([]);
  const line = (k: string, v: number, isMoney = true) => {
    const row = summary.addRow([k, isMoney ? pesos(v) : v]);
    if (isMoney) row.getCell(2).numFmt = MONEY;
    return row;
  };
  line("Ventas (cobradas, sin cancelar)", sales).font = { bold: true };
  line("Número de ventas", sold.length, false);
  line("Ticket promedio", sold.length ? Math.round(sales / sold.length) : 0);
  line("Costo de lo vendido", cost);
  line("Utilidad bruta", sales - cost).font = { bold: true };
  line("Envíos cobrados (incluidos en ventas)", sold.reduce((s, o) => s + Number(o.delivery_fee), 0));
  line("Comisiones de tarjeta (no cuentan como venta)", sold.reduce((s, o) => s + Number(o.processing_fee), 0));
  const cancelled = orders.filter((o) => o.status === "cancelado");
  line(`Canceladas (${cancelled.length})`, cancelled.reduce((s, o) => s + Number(o.total), 0));
  const unpaid = orders.filter((o) => o.status !== "cancelado" && o.payment_status !== "pagado");
  if (unpaid.length) line(`Sin cobrar todavía (${unpaid.length})`, unpaid.reduce((s, o) => s + Number(o.total), 0));

  summary.addRow([]);
  summary.addRow(["Por forma de pago", "Total", "Ventas"]).font = { bold: true };
  const byMethod = new Map<string, { total: number; n: number }>();
  for (const o of sold) {
    const m = byMethod.get(o.payment_method) ?? { total: 0, n: 0 };
    m.total += net(o);
    m.n += 1;
    byMethod.set(o.payment_method, m);
  }
  for (const [m, v] of [...byMethod].sort((x, y) => y[1].total - x[1].total)) {
    const row = summary.addRow([PAYMENT_LABEL[m as PaymentMethod] ?? m, pesos(v.total), v.n]);
    row.getCell(2).numFmt = MONEY;
  }
  summary.addRow([]);
  summary.addRow(["Por canal", "Total", "Ventas"]).font = { bold: true };
  const byChannel = new Map<string, { total: number; n: number }>();
  for (const o of sold) {
    const c = byChannel.get(o.channel) ?? { total: 0, n: 0 };
    c.total += net(o);
    c.n += 1;
    byChannel.set(o.channel, c);
  }
  for (const [c, v] of byChannel) {
    const row = summary.addRow([CHANNEL[c] ?? c, pesos(v.total), v.n]);
    row.getCell(2).numFmt = MONEY;
  }

  // ---- Hoja 2: Ventas (una fila por pedido) ----
  const ws = wb.addWorksheet("Ventas");
  ws.columns = [
    { header: "Folio", key: "folio", width: 10 },
    { header: "Fecha", key: "fecha", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Hora", key: "hora", width: 9 },
    { header: "Canal", key: "canal", width: 11 },
    { header: "Entrega", key: "entrega", width: 13 },
    { header: "Cliente", key: "cliente", width: 22 },
    { header: "Teléfono", key: "tel", width: 13 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Forma de pago", key: "metodo", width: 16 },
    { header: "Pago", key: "pago", width: 11 },
    { header: "¿Cuenta como venta?", key: "cuenta", width: 12 },
    { header: "Subtotal", key: "subtotal", width: 12, style: { numFmt: MONEY } },
    { header: "Envío", key: "envio", width: 11, style: { numFmt: MONEY } },
    { header: "Cargo por servicio", key: "servicio", width: 12, style: { numFmt: MONEY } },
    { header: "Comisión tarjeta", key: "comision", width: 12, style: { numFmt: MONEY } },
    { header: "Total cobrado", key: "total", width: 13, style: { numFmt: MONEY } },
    { header: "Venta neta", key: "neta", width: 13, style: { numFmt: MONEY } },
    { header: "Costo", key: "costo", width: 12, style: { numFmt: MONEY } },
    { header: "Utilidad", key: "utilidad", width: 12, style: { numFmt: MONEY } },
    { header: "Motivo de cancelación", key: "motivo", width: 28 },
  ];
  for (const o of orders) {
    const ok = counts(o);
    ws.addRow({
      folio: orderCode(o.id),
      fecha: excelDate(o.created_at),
      hora: time(o.created_at),
      canal: CHANNEL[o.channel] ?? o.channel,
      entrega: DELIVERY[o.delivery_type] ?? o.delivery_type,
      cliente: o.customer_name,
      tel: o.phone,
      estado: ORDER_STATUS_LABEL[o.status as OrderStatus] ?? o.status,
      metodo: PAYMENT_LABEL[o.payment_method as PaymentMethod] ?? o.payment_method,
      pago: o.payment_status === "pagado" ? "Pagado" : "Pendiente",
      cuenta: ok ? "Sí" : "No",
      subtotal: pesos(o.subtotal),
      envio: pesos(o.delivery_fee),
      servicio: pesos(o.service_fee),
      comision: pesos(o.processing_fee),
      total: pesos(o.total),
      // Solo las ventas que cuentan suman en neta, costo y utilidad
      neta: ok ? pesos(net(o)) : 0,
      costo: ok ? pesos(o.cost) : 0,
      utilidad: ok ? pesos(net(o) - Number(o.cost)) : 0,
      motivo: o.cancel_reason,
    });
  }
  styleHeader(ws);
  totalsRow(ws, "TOTAL", ["neta", "costo", "utilidad"]);

  // ---- Hoja 3: Productos vendidos (detalle por renglón) ----
  const wi = wb.addWorksheet("Detalle de productos");
  wi.columns = [
    { header: "Folio", key: "folio", width: 10 },
    { header: "Fecha", key: "fecha", width: 12, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Hora", key: "hora", width: 9 },
    { header: "Producto", key: "producto", width: 32 },
    { header: "Notas", key: "notas", width: 22 },
    { header: "Cantidad", key: "cantidad", width: 10 },
    { header: "Precio unitario", key: "precio", width: 13, style: { numFmt: MONEY } },
    { header: "Importe", key: "importe", width: 13, style: { numFmt: MONEY } },
    { header: "Costo unitario", key: "cu", width: 13, style: { numFmt: MONEY } },
    { header: "Costo total", key: "ct", width: 13, style: { numFmt: MONEY } },
    { header: "Utilidad", key: "utilidad", width: 13, style: { numFmt: MONEY } },
  ];
  for (const it of items) {
    const qty = Number(it.qty);
    wi.addRow({
      folio: orderCode(it.order_id),
      fecha: excelDate(it.created_at),
      hora: time(it.created_at),
      producto: it.name,
      notas: it.notes,
      cantidad: qty,
      precio: pesos(it.unit_price),
      importe: pesos(it.unit_price * qty),
      cu: pesos(it.unit_cost),
      ct: pesos(it.unit_cost * qty),
      utilidad: pesos((it.unit_price - it.unit_cost) * qty),
    });
  }
  styleHeader(wi);
  totalsRow(wi, "TOTAL", ["cantidad", "importe", "ct", "utilidad"]);

  // ---- Hoja 4: Por producto ----
  const wp = wb.addWorksheet("Por producto");
  wp.columns = [
    { header: "Producto", key: "producto", width: 32 },
    { header: "Cantidad", key: "cantidad", width: 10 },
    { header: "Ventas", key: "ventas", width: 13, style: { numFmt: MONEY } },
    { header: "Costo", key: "costo", width: 13, style: { numFmt: MONEY } },
    { header: "Utilidad", key: "utilidad", width: 13, style: { numFmt: MONEY } },
    { header: "Margen", key: "margen", width: 10, style: { numFmt: "0%" } },
  ];
  const byProduct = new Map<string, { qty: number; sales: number; cost: number }>();
  for (const it of items) {
    const p = byProduct.get(it.name) ?? { qty: 0, sales: 0, cost: 0 };
    p.qty += Number(it.qty);
    p.sales += it.unit_price * it.qty;
    p.cost += it.unit_cost * it.qty;
    byProduct.set(it.name, p);
  }
  for (const [name, p] of [...byProduct].sort((x, y) => y[1].sales - x[1].sales)) {
    wp.addRow({
      producto: name,
      cantidad: p.qty,
      ventas: pesos(p.sales),
      costo: pesos(p.cost),
      utilidad: pesos(p.sales - p.cost),
      margen: p.sales ? (p.sales - p.cost) / p.sales : 0,
    });
  }
  styleHeader(wp);
  totalsRow(wp, "TOTAL", ["cantidad", "ventas", "costo", "utilidad"]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
