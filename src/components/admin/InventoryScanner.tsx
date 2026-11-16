"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupplyFromBarcode, linkBarcode, lookupBarcode, restock } from "@/app/admin/actions";
import type { BarcodeMatch } from "@/lib/barcode";
import { money } from "@/lib/format";
import BarcodeScanner from "./BarcodeScanner";

type Target = { item: string; label: string; group: string };

/** Inventario con la cámara: escanea un código y resurte, o asígnalo a un producto/insumo. */
export default function InventoryScanner({ targets }: { targets: Target[] }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState("");
  const [match, setMatch] = useState<BarcodeMatch | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [assignTo, setAssignTo] = useState("");
  const [newSupply, setNewSupply] = useState({ name: "", unit: "pza", qty: "", cost: "", min: "" });

  function reset() {
    setCode("");
    setMatch(null);
    setNotFound(false);
    setAssignTo("");
    setNewSupply({ name: "", unit: "pza", qty: "", cost: "", min: "" });
  }

  function onCode(c: string) {
    setScanning(false);
    setMsg(null);
    setCode(c);
    start(async () => {
      const m = await lookupBarcode(c);
      setMatch(m);
      setNotFound(!m);
    });
  }

  function saveRestock(form: HTMLFormElement) {
    const fd = new FormData(form);
    const qty = Number(fd.get("qty"));
    if (!match || !(qty > 0)) return;
    start(async () => {
      await restock(fd);
      setMsg({ ok: true, text: `✓ Se agregaron ${qty} ${match.type === "supply" ? match.unit : "pza"} de ${match.name}.` });
      reset();
      router.refresh();
    });
  }

  function assign() {
    if (!assignTo) return;
    start(async () => {
      const m = await linkBarcode(assignTo, code);
      setMatch(m);
      setNotFound(!m);
      setMsg(m ? { ok: true, text: `Código guardado en ${m.name}. Ahora registra cuántos entran.` } : null);
      router.refresh();
    });
  }

  function createSupply() {
    if (!newSupply.name.trim()) return;
    start(async () => {
      const m = await createSupplyFromBarcode({
        code,
        name: newSupply.name,
        unit: newSupply.unit,
        qty: Number(newSupply.qty) || 0,
        costPerUnit: Number(newSupply.cost) || 0,
        minQty: Number(newSupply.min) || 0,
      });
      setMsg(m ? { ok: true, text: `✓ Insumo “${m.name}” creado con su código.` } : { ok: false, text: "No se pudo crear el insumo." });
      reset();
      router.refresh();
    });
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">📷 Escanear código de barras</h2>
          <p className="text-sm text-cafe-600">Usa la cámara del celular para resurtir rápido.</p>
        </div>
        <button className="btn-primary" onClick={() => setScanning(true)} disabled={pending}>
          📷 Escanear
        </button>
      </div>

      {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {pending && !match && !notFound && code && <p className="text-sm text-cafe-600">Buscando {code}…</p>}

      {match && (
        <form
          className="space-y-3 rounded-xl bg-cafe-50 p-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            saveRestock(e.currentTarget);
          }}
        >
          <input type="hidden" name="item" value={match.item} />
          <div>
            <p className="text-lg font-semibold">{match.name}</p>
            <p className="text-cafe-600">
              Código {code} · hay {match.qty} {match.type === "supply" ? match.unit : "pza"}
              {match.cost ? ` · costo ${money(match.cost)}/${match.type === "supply" ? match.unit : "pza"}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-cafe-600">Cantidad que entra</span>
              <input name="qty" type="number" step="any" min="0.01" defaultValue={1} className="input text-lg" required autoFocus />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-cafe-600">Costo total ($, opcional)</span>
              <input name="total_cost" type="number" step="0.01" min="0" className="input text-lg" />
            </label>
          </div>
          <input name="note" className="input" placeholder="Nota (proveedor, factura…)" />
          <div className="space-y-1">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="register_expense" defaultChecked /> Registrar como gasto de resurtido
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="update_cost" defaultChecked /> Actualizar costo por unidad
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={pending}>
              {pending ? "Guardando…" : "Guardar entrada"}
            </button>
            <button type="button" className="btn-secondary" onClick={reset}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {notFound && (
        <div className="space-y-3 rounded-xl bg-amber-50 p-3 text-sm">
          <p>
            El código <b>{code}</b> todavía no está registrado.
          </p>
          <div className="space-y-2">
            <p className="font-medium">Asignarlo a un producto o insumo que ya tienes:</p>
            <div className="flex flex-wrap gap-2">
              <select className="input min-w-0 flex-1" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Selecciona…</option>
                {["Productos del menú", "Insumos"].map((g) => (
                  <optgroup key={g} label={g}>
                    {targets
                      .filter((t) => t.group === g)
                      .map((t) => (
                        <option key={t.item} value={t.item}>
                          {t.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <button className="btn-secondary" onClick={assign} disabled={!assignTo || pending}>
                Asignar
              </button>
            </div>
          </div>
          <div className="space-y-2 border-t border-amber-200 pt-3">
            <p className="font-medium">O crear un insumo nuevo con este código:</p>
            <input
              className="input"
              placeholder="Nombre (ej. Leche entera 1 L)"
              value={newSupply.name}
              onChange={(e) => setNewSupply({ ...newSupply, name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input className="input" placeholder="Unidad" value={newSupply.unit} onChange={(e) => setNewSupply({ ...newSupply, unit: e.target.value })} />
              <input className="input" type="number" step="any" min="0" placeholder="Hay ahora" value={newSupply.qty} onChange={(e) => setNewSupply({ ...newSupply, qty: e.target.value })} />
              <input className="input" type="number" step="0.01" min="0" placeholder="Costo/unidad $" value={newSupply.cost} onChange={(e) => setNewSupply({ ...newSupply, cost: e.target.value })} />
              <input className="input" type="number" step="any" min="0" placeholder="Mínimo" value={newSupply.min} onChange={(e) => setNewSupply({ ...newSupply, min: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={createSupply} disabled={!newSupply.name.trim() || pending}>
                Crear insumo
              </button>
              <button className="btn-secondary" onClick={reset}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {scanning && <BarcodeScanner onDetected={onCode} onClose={() => setScanning(false)} />}
    </section>
  );
}
