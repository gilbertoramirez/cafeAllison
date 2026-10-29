"use client";

import { useState, useTransition } from "react";
import { cancelOrder, deleteOrder } from "@/app/admin/actions";

const REASONS = ["Error al cobrar", "El cliente se arrepintió", "Producto no disponible", "Venta de prueba", "Pedido duplicado"];

/**
 * Cancelar una venta (con motivo y confirmación) o, si ya está cancelada, eliminarla definitivamente.
 */
export default function CancelOrderControls({
  orderId,
  cancelled,
  paidOnline = false,
  onDone,
  compact = false,
}: {
  orderId: number;
  cancelled: boolean;
  /** pagado con Stripe: recordar que el reembolso se hace en Stripe */
  paidOnline?: boolean;
  onDone?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const code = `#${String(orderId).padStart(4, "0")}`;

  if (!open) {
    return cancelled ? (
      <button type="button" className="btn text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}>
        🗑️ Eliminar
      </button>
    ) : (
      <button
        type="button"
        className={compact ? "text-sm text-red-700 underline" : "btn text-red-700 hover:bg-red-50"}
        onClick={() => setOpen(true)}
      >
        {compact ? "Cancelar esta venta" : "Cancelar"}
      </button>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setOpen(false);
        onDone?.();
      } else setError(res.error ?? "No se pudo completar");
    });
  }

  if (cancelled) {
    return (
      <div className="w-full space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <p className="font-medium text-red-800">¿Eliminar {code} definitivamente?</p>
        <p className="text-red-700">Desaparece del historial y no se puede deshacer.</p>
        {error && <p className="text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-danger" disabled={pending} onClick={() => run(() => deleteOrder(orderId))}>
            {pending ? "Eliminando…" : "Sí, eliminar"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
            No
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-left text-sm">
      <p className="font-medium text-red-800">¿Cancelar la venta {code}?</p>
      <p className="text-red-700">
        Se quita de las ventas y finanzas y las existencias regresan al inventario.
        {paidOnline && " Se pagó en línea: haz el reembolso desde tu panel de Stripe."}
      </p>
      <div className="flex flex-wrap gap-1">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full px-2.5 py-1 text-xs ${reason === r ? "bg-red-700 text-white" : "bg-white text-red-800 ring-1 ring-red-200"}`}
          >
            {r}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder="Motivo de la cancelación"
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-danger"
          disabled={pending || !reason.trim()}
          onClick={() => run(() => cancelOrder(orderId, reason))}
        >
          {pending ? "Cancelando…" : "Sí, cancelar venta"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          No
        </button>
      </div>
    </div>
  );
}
