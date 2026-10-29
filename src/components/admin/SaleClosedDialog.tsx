"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import TicketPreview from "@/components/TicketPreview";
import CancelOrderControls from "./CancelOrderControls";
import { money } from "@/lib/format";
import {
  connectBluetooth,
  connectedName,
  connectUsb,
  fetchTickets,
  loadPrinter,
  openDrawer,
  printTickets,
  shouldOpenDrawer,
  type PrinterSettings,
} from "@/lib/printer";
import type { TicketData } from "@/lib/ticket";

const METHOD_LABEL: Record<PrinterSettings["method"], string> = {
  bluetooth: "Bluetooth",
  usb: "USB",
  rawbt: "App RawBT",
  browser: "Diálogo de impresión",
};

type PrintState = { kind: "idle" } | { kind: "busy" } | { kind: "ok" } | { kind: "error"; text: string };

/** Resultado de cobrar en la caja (la caja ya intentó imprimir/abrir el cajón al cobrar). */
export type SaleResult = {
  orderId: number;
  change: number;
  ticket: TicketData | null;
  printed?: boolean;
  drawerOpened?: boolean;
  error?: string;
};

/** Se abre al cerrar una venta: muestra el ticket y permite imprimirlo. */
export default function SaleClosedDialog({ sale, onClose }: { sale: SaleResult; onClose: () => void }) {
  const { orderId, change } = sale;
  const [settings] = useState<PrinterSettings>(() => loadPrinter());
  const [ticket, setTicket] = useState<TicketData | null>(sale.ticket);
  const [loadError, setLoadError] = useState("");
  const [print, setPrint] = useState<PrintState>(
    sale.error ? { kind: "error", text: sale.error } : sale.printed ? { kind: "ok" } : { kind: "idle" },
  );
  const [drawerOpened, setDrawerOpened] = useState(Boolean(sale.drawerOpened));
  const [cancelled, setCancelled] = useState(false);
  const [device, setDevice] = useState<string | null>(() => connectedName());
  const needsConnection = (settings.method === "bluetooth" || settings.method === "usb") && !device;
  const drawerAvailable = Boolean(ticket && shouldOpenDrawer(ticket, settings));

  const doPrint = useCallback(
    async (data: TicketData) => {
      setPrint({ kind: "busy" });
      try {
        // Si el cajón no se abrió al cobrar (p. ej. faltaba conectar), se abre con esta impresión
        const withDrawer = !drawerOpened && shouldOpenDrawer(data, settings);
        await printTickets([data], settings, { openDrawer: withDrawer });
        if (withDrawer) setDrawerOpened(true);
        setDevice(connectedName());
        setPrint({ kind: "ok" });
      } catch (e) {
        setPrint({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      }
    },
    [settings, drawerOpened],
  );

  // Respaldo: si la caja no trajo el ticket, se consulta
  useEffect(() => {
    if (sale.ticket) return;
    let alive = true;
    fetchTickets(`ids=${orderId}`)
      .then(([t]) => alive && (t ? setTicket(t) : setLoadError("No se encontró la venta.")))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "Error al cargar el ticket"));
    return () => {
      alive = false;
    };
  }, [orderId, sale.ticket]);

  async function drawer() {
    try {
      await openDrawer(settings);
      setDrawerOpened(true);
    } catch (e) {
      setPrint({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function connect() {
    setPrint({ kind: "busy" });
    try {
      const name = settings.method === "bluetooth" ? await connectBluetooth() : await connectUsb();
      setDevice(name);
      if (ticket) await doPrint(ticket);
      else setPrint({ kind: "idle" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrint({ kind: "error", text: /cancel/i.test(msg) ? "Se canceló la selección de impresora." : msg });
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Venta cerrada"
        className="flex max-h-[95dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-green-700 px-5 py-4 text-white">
          <p className="text-sm opacity-90">✅ Venta cerrada</p>
          <p className="text-2xl font-bold">
            #{String(orderId).padStart(4, "0")} · {ticket ? money(ticket.order.total) : "…"}
          </p>
          {change > 0 && <p className="mt-1 text-lg font-semibold">Cambio: {money(change)}</p>}
        </div>

        <div className="flex-1 overflow-y-auto bg-cafe-100 p-4">
          {loadError ? (
            <p className="text-sm text-red-700">{loadError}</p>
          ) : ticket ? (
            <div className="mx-auto w-fit rounded bg-white p-3 shadow">
              <TicketPreview data={ticket} width={settings.width} />
            </div>
          ) : (
            <p className="text-center text-sm text-cafe-600">Cargando ticket…</p>
          )}
        </div>

        <div className="space-y-3 border-t border-cafe-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p className="text-xs text-cafe-600">
            Impresora: <strong>{METHOD_LABEL[settings.method]}</strong> · {settings.width} mm
            {device ? <span className="text-green-700"> · ✓ {device}</span> : needsConnection ? <span className="text-amber-700"> · sin conectar</span> : null}
            {" · "}
            <Link href="/admin/ajustes" className="underline">
              Configurar
            </Link>
          </p>

          {print.kind === "ok" && <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800">🖨️ Ticket enviado a la impresora.</p>}
          {drawerAvailable && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className={drawerOpened ? "text-green-700" : "text-cafe-600"}>
                {drawerOpened ? "🗄️ Cajón abierto" : "🗄️ El cajón no se abrió"}
              </span>
              <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={drawer}>
                Abrir cajón
              </button>
            </div>
          )}
          {print.kind === "error" && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">No se imprimió: {print.text}</p>}

          <div className="flex gap-2">
            {cancelled ? (
              <p className="flex-1 rounded-lg bg-gray-100 p-3 text-sm text-gray-700">✖ Venta cancelada. Las existencias regresaron al inventario.</p>
            ) : needsConnection ? (
              <button className="btn-primary flex-1 py-3 text-base" disabled={print.kind === "busy"} onClick={connect}>
                {print.kind === "busy" ? "Conectando…" : `📶 Conectar e imprimir`}
              </button>
            ) : (
              <button
                className="btn-primary flex-1 py-3 text-base"
                disabled={!ticket || print.kind === "busy"}
                onClick={() => ticket && doPrint(ticket)}
              >
                {print.kind === "busy" ? "Imprimiendo…" : print.kind === "ok" ? "🖨️ Imprimir otra vez" : "🖨️ Imprimir ticket"}
              </button>
            )}
            <button className="btn-secondary px-5 py-3 text-base" onClick={onClose} autoFocus>
              Nueva venta
            </button>
          </div>
          {!cancelled && (
            <div className="text-center">
              <CancelOrderControls orderId={orderId} cancelled={false} compact onDone={() => setCancelled(true)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
