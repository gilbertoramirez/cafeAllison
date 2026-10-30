"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";

export const PENDING_KEY = "cafe_pending_order";
import { CART_KEY } from "@/lib/myOrders";

/** Pedido con tarjeta que aún no se paga: pagar ahora o volver al menú con el carrito. */
export default function PendingPayment({ token, total, confirming }: { token: string; total: number; confirming: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"pay" | "change" | null>(null);
  const [error, setError] = useState("");

  async function pay() {
    setBusy("pay");
    setError("");
    try {
      const res = await fetch(`/api/orders/${token}/pagar`, { method: "POST" });
      const data = await res.json();
      if (data.checkoutUrl) return window.location.assign(data.checkoutUrl);
      if (data.paid) return window.location.reload();
      throw new Error(data.error || "No se pudo abrir el pago");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setBusy(null);
    }
  }

  async function change() {
    setBusy("change");
    setError("");
    try {
      const res = await fetch(`/api/orders/${token}/cancelar`, { method: "POST" });
      const data = await res.json();
      if (data.paid) return window.location.reload();
      if (!res.ok) throw new Error(data.error || "No se pudo cancelar");
      // Rehace el carrito para elegir otra forma de pago
      const cart = (data.cart as { productId: number; qty: number; note: string }[]).map((l) => ({
        key: `${l.productId}|${l.note ?? ""}`,
        productId: l.productId,
        qty: l.qty,
        note: l.note ?? "",
      }));
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        localStorage.removeItem(PENDING_KEY);
      } catch {}
      router.push("/?pedido=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-3 border-amber-200 bg-amber-50">
      {confirming ? (
        <p className="text-amber-900">Estamos confirmando tu pago; esta página se actualizará sola.</p>
      ) : (
        <>
          <p className="font-semibold text-amber-900">Tu pago no se completó</p>
          <p className="text-sm text-amber-800">
            Tu pedido todavía no se envía a la cafetería. Puedes pagarlo ahora o elegir otra forma de pago.
          </p>
        </>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button className="btn-primary flex-1 py-3" disabled={busy !== null} onClick={pay}>
          {busy === "pay" ? "Abriendo pago…" : `💳 Pagar ahora ${money(total)}`}
        </button>
        <button className="btn-secondary flex-1 py-3" disabled={busy !== null} onClick={change}>
          {busy === "change" ? "Un momento…" : "Cambiar forma de pago"}
        </button>
      </div>
    </div>
  );
}

/** Cuando el pago con tarjeta se confirma, vacía el carrito que se guardó para reintentar. */
export function ClearCartWhenPaid({ token }: { token: string }) {
  useEffect(() => {
    try {
      if (localStorage.getItem(PENDING_KEY) === token) {
        localStorage.removeItem(PENDING_KEY);
        localStorage.setItem(CART_KEY, "[]");
      }
    } catch {}
  }, [token]);
  return null;
}
