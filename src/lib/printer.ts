/**
 * Impresión de tickets desde el navegador (se ejecuta solo en el cliente).
 * Métodos:
 *  - bluetooth: Chrome en Android/PC habla directo con la impresora (Web Bluetooth, ESC/POS).
 *  - usb:       Chrome con cable USB/OTG (WebUSB, ESC/POS).
 *  - rawbt:     app RawBT de Android como puente (funciona con casi cualquier impresora).
 *  - browser:   diálogo de impresión del sistema (cualquier impresora instalada).
 * La configuración se guarda en este dispositivo.
 */
import { colsFor, escpos, ticketLines, type TicketData } from "./ticket";

export type PrintMethod = "browser" | "bluetooth" | "usb" | "rawbt";
export type PrinterSettings = {
  method: PrintMethod;
  width: 58 | 80;
  autoPrintSale: boolean;
  autoPrintOnline: boolean;
  cut: boolean;
  drawer: boolean;
  copies: number;
};

const KEY = "cafe_printer_v1";
export const DEFAULT_PRINTER: PrinterSettings = {
  method: "browser",
  width: 80,
  autoPrintSale: false,
  autoPrintOnline: false,
  cut: true,
  drawer: false,
  copies: 1,
};

export function loadPrinter(): PrinterSettings {
  try {
    return { ...DEFAULT_PRINTER, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULT_PRINTER;
  }
}

export function savePrinter(s: PrinterSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

// ---------- Tipos mínimos de Web Bluetooth / WebUSB (no vienen en lib.dom) ----------
type BTCharacteristic = {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
};
type BTService = { getCharacteristics(): Promise<BTCharacteristic[]> };
type BTServer = { connected: boolean; getPrimaryServices(): Promise<BTService[]> };
type BTDevice = { name?: string; gatt?: { connected: boolean; connect(): Promise<BTServer> } };
type Bluetooth = {
  requestDevice(o: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BTDevice>;
  getDevices?(): Promise<BTDevice[]>;
};
type USBEndpoint = { direction: "in" | "out"; type: string; endpointNumber: number };
type USBInterface = { interfaceNumber: number; alternate: { interfaceClass: number; endpoints: USBEndpoint[] } };
type USBDev = {
  productName?: string;
  opened: boolean;
  configuration: { interfaces: USBInterface[] } | null;
  open(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<unknown>;
};
type USB = { requestDevice(o: { filters: object[] }): Promise<USBDev>; getDevices(): Promise<USBDev[]> };

const nav = () => navigator as Navigator & { bluetooth?: Bluetooth; usb?: USB };

export function supports(method: PrintMethod): boolean {
  if (typeof navigator === "undefined") return false;
  if (method === "bluetooth") return Boolean(nav().bluetooth);
  if (method === "usb") return Boolean(nav().usb);
  if (method === "rawbt") return /android/i.test(navigator.userAgent);
  return true;
}

// Servicios Bluetooth usados por la mayoría de las impresoras térmicas
const BT_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
];

let btDevice: BTDevice | null = null;
let btChar: BTCharacteristic | null = null;
let usbDevice: USBDev | null = null;
let usbEndpoint = 1;

export function connectedName(): string | null {
  if (btChar && btDevice?.gatt?.connected) return btDevice.name || "Impresora Bluetooth";
  if (usbDevice?.opened) return usbDevice.productName || "Impresora USB";
  return null;
}

async function findWritable(server: BTServer): Promise<BTCharacteristic> {
  for (const svc of await server.getPrimaryServices()) {
    for (const c of await svc.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) return c;
    }
  }
  throw new Error("La impresora no tiene un canal de escritura compatible.");
}

/** Debe llamarse desde un toque del usuario (botón). */
export async function connectBluetooth(): Promise<string> {
  const bt = nav().bluetooth;
  if (!bt) throw new Error("Este navegador no permite Bluetooth. Usa Chrome en Android o computadora.");
  btDevice = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  const server = await btDevice.gatt!.connect();
  btChar = await findWritable(server);
  return btDevice.name || "Impresora Bluetooth";
}

async function ensureBluetooth() {
  if (btChar && btDevice?.gatt?.connected) return;
  if (btDevice?.gatt) {
    btChar = await findWritable(await btDevice.gatt.connect());
    return;
  }
  // Chrome puede recordar impresoras ya autorizadas
  const known = (await nav().bluetooth?.getDevices?.()) ?? [];
  if (known[0]?.gatt) {
    btDevice = known[0];
    btChar = await findWritable(await known[0].gatt!.connect());
    return;
  }
  throw new Error("Conecta la impresora Bluetooth en Ajustes → Impresora.");
}

async function sendBluetooth(data: Uint8Array) {
  await ensureBluetooth();
  const c = btChar!;
  let chunk = 180;
  for (let i = 0; i < data.length; ) {
    const part = data.slice(i, i + chunk);
    try {
      if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(part);
      else await c.writeValue(part);
      i += part.length;
      await new Promise((r) => setTimeout(r, 15));
    } catch (e) {
      if (chunk > 20) chunk = 20; // algunas impresoras solo aceptan paquetes pequeños
      else throw e;
    }
  }
}

async function openUsb(dev: USBDev) {
  if (!dev.opened) await dev.open();
  if (!dev.configuration) await dev.selectConfiguration(1);
  const ifaces = dev.configuration!.interfaces;
  const iface =
    ifaces.find((i) => i.alternate.interfaceClass === 7) ?? // clase "impresora"
    ifaces.find((i) => i.alternate.endpoints.some((e) => e.direction === "out" && e.type === "bulk"));
  if (!iface) throw new Error("No se encontró la salida de datos de la impresora USB.");
  await dev.claimInterface(iface.interfaceNumber);
  usbEndpoint = iface.alternate.endpoints.find((e) => e.direction === "out")!.endpointNumber;
  usbDevice = dev;
}

/** Debe llamarse desde un toque del usuario (botón). */
export async function connectUsb(): Promise<string> {
  const usb = nav().usb;
  if (!usb) throw new Error("Este navegador no permite USB. Usa Chrome en Android o computadora.");
  await openUsb(await usb.requestDevice({ filters: [] }));
  return usbDevice!.productName || "Impresora USB";
}

async function sendUsb(data: Uint8Array) {
  if (!usbDevice?.opened) {
    const [dev] = (await nav().usb?.getDevices()) ?? [];
    if (!dev) throw new Error("Conecta la impresora USB en Ajustes → Impresora.");
    await openUsb(dev);
  }
  for (let i = 0; i < data.length; i += 4096) await usbDevice!.transferOut(usbEndpoint, data.slice(i, i + 4096));
}

function sendRawBT(data: Uint8Array) {
  let bin = "";
  data.forEach((b) => (bin += String.fromCharCode(b)));
  window.location.href = `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

function printWithBrowser(query: string, width: number) {
  // Iframe oculto para no salir de la página actual
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  frame.src = `/admin/ticket?${query}&w=${width}&auto=1`;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 60_000);
}

export async function fetchTickets(query: string): Promise<TicketData[]> {
  const res = await fetch(`/api/admin/tickets?${query}`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudieron obtener los datos del ticket.");
  return (await res.json()).tickets;
}

export async function printTickets(tickets: TicketData[], s: PrinterSettings = loadPrinter()) {
  if (tickets.length === 0) return;
  if (s.method === "browser") return printWithBrowser(`ids=${tickets.map((t) => t.order.id).join(",")}`, s.width);
  const cols = colsFor(s.width);
  const parts = tickets.map((t) =>
    escpos(ticketLines(t, cols), {
      cut: s.cut,
      copies: s.copies,
      // el cajón solo se abre en ventas de mostrador en efectivo
      drawer: s.drawer && t.order.channel === "mostrador" && t.order.payment_method === "efectivo",
    }),
  );
  const data = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let off = 0;
  for (const p of parts) {
    data.set(p, off);
    off += p.length;
  }
  if (s.method === "bluetooth") await sendBluetooth(data);
  else if (s.method === "usb") await sendUsb(data);
  else sendRawBT(data);
}

export async function printOrders(ids: number[], s: PrinterSettings = loadPrinter()) {
  if (s.method === "browser") return printWithBrowser(`ids=${ids.join(",")}`, s.width);
  await printTickets(await fetchTickets(`ids=${ids.join(",")}`), s);
}

export const SAMPLE_TICKET: TicketData = {
  business: { name: "Café Allison", address: "", phone: "" },
  order: {
    id: 0,
    channel: "mostrador",
    status: "entregado",
    customer_name: "Prueba de impresión",
    phone: "",
    delivery_type: "mostrador",
    address: "",
    address_ref: "",
    postal_code: "",
    notes: "Acentos: áéíóú ñ ¿¡",
    payment_method: "efectivo",
    payment_status: "pagado",
    cash_given: 20000,
    subtotal: 13500,
    delivery_fee: 0,
    total: 13500,
    created_at: new Date().toISOString(),
  },
  items: [
    { name: "Capuchino Clásico (G 16oz)", qty: 2, unit_price: 5000, notes: "leche deslactosada" },
    { name: "Rol individual", qty: 1, unit_price: 3500, notes: "" },
  ],
};

export async function printSample(s: PrinterSettings, businessName: string) {
  if (s.method === "browser") return printWithBrowser("sample=1", s.width);
  await printTickets([{ ...SAMPLE_TICKET, business: { ...SAMPLE_TICKET.business, name: businessName } }], s);
}
