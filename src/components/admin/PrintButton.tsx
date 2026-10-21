"use client";

import { useState } from "react";
import { printOrders } from "@/lib/printer";

export default function PrintButton({ orderId, className = "btn-secondary" }: { orderId: number; className?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        className={className}
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          try {
            await printOrders([orderId]);
            setState("idle");
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo imprimir");
            setState("error");
          }
        }}
      >
        🖨️ {state === "busy" ? "Imprimiendo…" : "Imprimir"}
      </button>
      {state === "error" && <span className="mt-1 max-w-56 text-xs text-red-700">{error}</span>}
    </span>
  );
}
