"use client";

import { useState } from "react";
import { coordsFromMapsLink } from "@/app/admin/actions";
import { isShortMapsLink, parseCoords } from "@/lib/coords";

const fmt = (lat: number, lng: number) => `${lat}, ${lng}`;

/**
 * Ubicación exacta de la cafetería: se pegan coordenadas o un link de Google Maps
 * (se convierte solo en coordenadas), o se toma del GPS de este dispositivo.
 */
export default function CafeLocationInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(text: string) {
    setValue(text);
    setMsg(null);
    const t = text.trim();
    if (!/^https?:\/\//i.test(t)) return; // números escritos a mano: se dejan tal cual
    const c = parseCoords(t);
    if (c) {
      setValue(fmt(c.lat, c.lng));
      setMsg({ ok: true, text: "✓ Coordenadas sacadas del link. Toca “Guardar envío”." });
      return;
    }
    if (!isShortMapsLink(t)) {
      setMsg({ ok: false, text: "Ese link no tiene coordenadas. Usa un link de Google Maps de tu local." });
      return;
    }
    setMsg({ ok: true, text: "Abriendo el link de Google Maps…" });
    const r = await coordsFromMapsLink(t).catch(() => null);
    if (r?.ok) {
      setValue(fmt(r.lat, r.lng));
      setMsg({ ok: true, text: "✓ Coordenadas sacadas del link. Toca “Guardar envío”." });
    } else {
      setMsg({ ok: false, text: r?.message ?? "No se pudo abrir el link. Intenta de nuevo." });
    }
  }

  function useDevice() {
    if (!navigator.geolocation) return setMsg({ ok: false, text: "Este dispositivo no comparte su ubicación." });
    setMsg({ ok: true, text: "Obteniendo ubicación…" });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setValue(fmt(Number(p.coords.latitude.toFixed(6)), Number(p.coords.longitude.toFixed(6))));
        setMsg({ ok: true, text: `Listo (precisión ~${Math.round(p.coords.accuracy)} m). Toca “Guardar envío”.` });
      },
      () => setMsg({ ok: false, text: "No se pudo obtener la ubicación. Revisa el permiso de ubicación del navegador." }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <input
          name="cafe_coords"
          className="input min-w-0 flex-1 font-mono"
          placeholder="Pega el link de Google Maps o 20.651006, -103.325934"
          value={value}
          onChange={(e) => change(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={useDevice}>
          📍 Estoy en la cafetería
        </button>
      </div>
      {msg && <p className={msg.ok ? "text-green-700" : "text-red-700"}>{msg.text}</p>}
    </div>
  );
}
