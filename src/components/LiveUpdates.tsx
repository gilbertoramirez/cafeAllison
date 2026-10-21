"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const STATUS_TEXT: Record<string, string> = {
  nuevo: "recibido",
  preparando: "en preparación",
  listo: "listo para recoger",
  en_camino: "en camino 🛵",
  entregado: "entregado ✅",
  cancelado: "cancelado",
};

type Msg = { v: number | string; online?: number; pending?: number; status?: string; payment?: string };

/** Sonido corto generado en el navegador (no requiere archivos). */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {}
}

/**
 * Escucha cambios en tiempo real y vuelve a cargar los datos de la página sin perder lo que estás haciendo.
 * mode "admin": todos los pedidos (con sonido y aviso de pedido nuevo).
 * mode "order": un pedido del cliente.
 */
export default function LiveUpdates({ url, mode }: { url: string; mode: "admin" | "order" }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const last = useRef<Msg | null>(null);

  const pending = useRef(0);

  // Muestra "(n)" pedidos pendientes en el título de la pestaña, aunque Next.js lo restaure al refrescar
  useEffect(() => {
    if (mode !== "admin") return;
    const apply = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, "");
      const want = pending.current > 0 ? `(${pending.current}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    apply();
    return () => obs.disconnect();
  }, [mode]);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      const t = setInterval(() => router.refresh(), 15000);
      return () => clearInterval(t);
    }
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource se reconecta solo
    es.onmessage = (ev) => {
      let msg: Msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      setConnected(true);
      const prev = last.current;
      last.current = msg;
      if (mode === "admin" && typeof msg.pending === "number") {
        pending.current = msg.pending;
        const base = document.title.replace(/^\(\d+\)\s*/, "");
        document.title = msg.pending > 0 ? `(${msg.pending}) ${base}` : base;
      }
      if (!prev || prev.v === msg.v) return; // primer mensaje: solo línea base
      router.refresh();
      if (mode === "admin" && (msg.online ?? 0) > (prev.online ?? 0)) {
        chime();
        setToast("🛵 ¡Nuevo pedido en línea!");
      } else if (mode === "order" && msg.status && msg.status !== prev.status) {
        chime();
        setToast(`Tu pedido está ${STATUS_TEXT[msg.status] ?? msg.status}`);
      } else if (mode === "order" && msg.payment === "pagado" && prev.payment !== "pagado") {
        setToast("¡Pago recibido! 💳");
      }
    };
    return () => es.close();
  }, [url, mode, router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <span
        className={`inline-flex items-center gap-1.5 text-xs ${connected ? "text-green-600" : "text-cafe-400"}`}
        title={connected ? "Actualizaciones en tiempo real activas" : "Reconectando…"}
      >
        <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse bg-green-500" : "bg-cafe-300"}`} />
        {connected ? "En vivo" : "Conectando…"}
      </span>
      {toast && (
        <div
          role="status"
          className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-sm items-center justify-between gap-3 rounded-2xl bg-cafe-900 px-4 py-3 text-sm text-white shadow-2xl"
        >
          <span className="font-medium">{toast}</span>
          {mode === "admin" ? (
            <Link href="/admin/pedidos" onClick={() => setToast(null)} className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs">
              Ver
            </Link>
          ) : (
            <button onClick={() => setToast(null)} className="shrink-0 text-lg leading-none" aria-label="Cerrar">
              ×
            </button>
          )}
        </div>
      )}
    </>
  );
}
