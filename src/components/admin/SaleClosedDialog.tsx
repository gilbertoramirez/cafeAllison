"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import TicketPreview from "@/components/TicketPreview";
import { money } from "@/lib/format";
import {
  connectBluetooth,
  connectedName,
  connectUsb,
  fetchTickets,
  loadPrinter,
  printTickets,
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

/** Se abre al cerrar una venta: muestra el ticket y permite imprimirlo. */
export default function SaleClosedDialog({
  orderId,
  change,
  onClose,
}: {
  orderId: number;
  change: number;
  onClose: () => void;
}) {
  const [settings] = useState<PrinterSettings>(() => loadPrinter());
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [print, setPrint] = useState<PrintState>({ kind: "idle" });
  const [device, setDevice] = useState<string | null>(() => connectedName());
  const autoTried = useRef(false);
  const needsConnection = (settings.method === "bluetooth" || settings.method === "usb") && !device;

  const doPrint = useCallback(
    async (data: TicketData) => {
      setPrint({ kind: "busy" });
      try {
        await printTickets([data], settings);
        setDevice(connectedName());
        setPrint({ kind: "ok" });
      } catch (e) {
        setPrint({ kind: "error", text: e instanceof Error ? e.message : String(e) });
      }
    },
    [settings],
  );

  useEffect(() => {
    let alive = true;
    fetchTickets(`ids=${orderId}`)
      .then(([t]) => {
        if (!alive) return;
        if (!t) return setLoadError("No se encontró la venta.");
        setTicket(t);
        // Impresión automática al cobrar (si está activada en este dispositivo)
        if (settings.autoPrintSale && !autoTried.current) {
          autoTried.current = true;
          doPrint(t);
        }
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "Error al cargar el ticket"));
    return () => {
      alive = false;
    };
  }, [orderId, settings.autoPrintSale, doPrint]);

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
          {print.kind === "error" && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">No se imprimió: {print.text}</p>}

          <div className="flex gap-2">
            {needsConnection ? (
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
        </div>
      </div>
    </div>
  );
}
