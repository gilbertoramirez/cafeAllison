"use client";

import { useState } from "react";

/** Ubicación exacta de la cafetería: se escribe "lat, lng" o se toma del GPS de este dispositivo. */
export default function CafeLocationInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const [msg, setMsg] = useState("");
  function useDevice() {
    if (!navigator.geolocation) return setMsg("Este dispositivo no comparte su ubicación.");
    setMsg("Obteniendo ubicación…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setValue(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setMsg(`Listo (precisión ~${Math.round(p.coords.accuracy)} m). Toca “Guardar envío”.`);
      },
      () => setMsg("No se pudo obtener la ubicación. Revisa el permiso de ubicación del navegador."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <input
          name="cafe_coords"
          className="input min-w-0 flex-1 font-mono"
          placeholder="19.432608, -99.133209"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={useDevice}>
          📍 Estoy en la cafetería
        </button>
      </div>
      {msg && <p className="text-cafe-700">{msg}</p>}
    </div>
  );
}
