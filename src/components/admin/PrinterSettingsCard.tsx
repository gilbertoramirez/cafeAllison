"use client";

import { useEffect, useState } from "react";
import {
  connectBluetooth,
  connectedName,
  connectUsb,
  DEFAULT_PRINTER,
  loadPrinter,
  printSample,
  savePrinter,
  supports,
  type PrintMethod,
  type PrinterSettings,
} from "@/lib/printer";

const METHODS: { id: PrintMethod; label: string; help: string }[] = [
  {
    id: "bluetooth",
    label: "Bluetooth directo",
    help: "Chrome en Android se conecta directo a la impresora (por ejemplo “58Printer”). No hace falta emparejarla en los ajustes de Android. Enciéndela, toca “Conectar” y elígela de la lista.",
  },
  {
    id: "usb",
    label: "USB directo",
    help: "Chrome con la impresora conectada por cable (en tableta, con adaptador OTG). Imprime sin preguntar y corta el papel.",
  },
  {
    id: "rawbt",
    label: "App RawBT (Android)",
    help: "Instala la app gratuita “RawBT” de Google Play. Empareja la impresora en Ajustes de Android → Bluetooth (PIN 0000 en la mayoría) y selecciónala dentro de RawBT. Funciona con casi cualquier impresora de tickets.",
  },
  {
    id: "browser",
    label: "Diálogo de impresión",
    help: "Usa la impresora instalada en el dispositivo (AirPrint, servicio de impresión de Android o Windows). Aparece el cuadro de impresión cada vez.",
  },
];

export default function PrinterSettingsCard({ businessName }: { businessName: string }) {
  const [s, setS] = useState<PrinterSettings>(DEFAULT_PRINTER);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  const [support, setSupport] = useState<Record<PrintMethod, boolean> | null>(null);

  // Lee la configuración guardada en este dispositivo (después de hidratar)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setS(loadPrinter());
    setDevice(connectedName());
    setSupport({ bluetooth: supports("bluetooth"), usb: supports("usb"), rawbt: supports("rawbt"), browser: true });
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function update(patch: Partial<PrinterSettings>) {
    const next = { ...s, ...patch };
    setS(next);
    savePrinter(next);
  }

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      setStatus({ ok: true, text: okText });
      setDevice(connectedName());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ ok: false, text: /cancel/i.test(msg) ? "Se canceló la selección." : msg });
    } finally {
      setBusy(false);
    }
  }

  const method = METHODS.find((m) => m.id === s.method)!;
  const unsupported = support && !support[s.method];

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold">🖨️ Impresora de tickets (este dispositivo)</h2>
        <p className="text-sm text-cafe-600">
          Esta configuración se guarda solo en este dispositivo: configúrala en la tableta o computadora donde está conectada la
          impresora.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => update({ method: m.id })}
            className={`rounded-lg border p-3 text-left text-sm font-medium ${
              s.method === m.id ? "border-cafe-700 bg-cafe-100 ring-2 ring-cafe-300" : "border-cafe-200 bg-white"
            }`}
          >
            {m.label}
            {support && !support[m.id] && <span className="block text-xs font-normal text-amber-700">No disponible en este navegador</span>}
          </button>
        ))}
      </div>
      <p className="rounded-lg bg-cafe-50 p-3 text-sm text-cafe-700">
        {method.help}
        {s.method === "rawbt" && (
          <>
            {" "}
            <a
              className="underline"
              href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir RawBT en Google Play
            </a>
          </>
        )}
      </p>
      {unsupported && (
        <p className="text-sm text-amber-700">
          Este navegador no admite este método. En Android usa Google Chrome actualizado.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="label">Ancho del rollo</span>
          <div className="flex gap-2">
            {([58, 80] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => update({ width: w })}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium ${
                  s.width === w ? "border-cafe-700 bg-cafe-100" : "border-cafe-200 bg-white"
                }`}
              >
                {w} mm
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="copies">
            Copias por ticket
          </label>
          <select id="copies" className="input" value={s.copies} onChange={(e) => update({ copies: Number(e.target.value) })}>
            <option value={1}>1</option>
            <option value={2}>2 (cliente y cocina)</option>
            <option value={3}>3</option>
          </select>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <Toggle checked={s.autoPrintSale} onChange={(v) => update({ autoPrintSale: v })}>
          Imprimir automáticamente al cobrar en la caja
        </Toggle>
        <Toggle checked={s.autoPrintOnline} onChange={(v) => update({ autoPrintOnline: v })}>
          Imprimir automáticamente los pedidos en línea al llegar (deja el panel abierto)
        </Toggle>
        {s.method !== "browser" && (
          <>
            <Toggle checked={s.cut} onChange={(v) => update({ cut: v })}>
              Cortar el papel al terminar
            </Toggle>
            <Toggle checked={s.drawer} onChange={(v) => update({ drawer: v })}>
              Abrir el cajón de dinero en ventas en efectivo
            </Toggle>
            <Toggle checked={!s.accents} onChange={(v) => update({ accents: !v })}>
              Imprimir sin acentos (actívalo si salen símbolos raros en vez de á, é, ñ)
            </Toggle>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {s.method === "bluetooth" && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(connectBluetooth, "Impresora conectada.")}>
            📶 Conectar impresora Bluetooth
          </button>
        )}
        {s.method === "usb" && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(connectUsb, "Impresora conectada.")}>
            🔌 Conectar impresora USB
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => run(() => printSample(s, businessName), "Ticket de prueba enviado.")}
        >
          🖨️ Imprimir prueba
        </button>
        {device && <span className="text-sm text-green-700">✓ {device}</span>}
      </div>
      {status && <p className={`text-sm ${status.ok ? "text-green-700" : "text-red-700"}`}>{status.text}</p>}
    </section>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
