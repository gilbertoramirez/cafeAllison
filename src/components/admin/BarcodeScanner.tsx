"use client";

import { useEffect, useRef, useState } from "react";

/** Detector nativo del navegador (Chrome en Android). No viene en los tipos de TypeScript. */
type NativeDetector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeDetectorClass = {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats: () => Promise<string[]>;
};

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1200;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch {}
}

/** Lector de códigos de barras con la cámara trasera. También permite escribir el código. */
export default function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);
  const [manual, setManual] = useState("");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let zxing: { stop: () => void } | null = null;
    const found = (code: string) => {
      if (stopped || !code) return;
      stopped = true;
      navigator.vibrate?.(80);
      beep();
      onDetectedRef.current(code.trim());
    };
    (async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("sin-camara");
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (stopped) return;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchAvailable(Boolean(caps.torch));
        setStarting(false);

        const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
        const supported = Native ? await Native.getSupportedFormats().catch(() => [] as string[]) : [];
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (Native && formats.length) {
          const detector = new Native({ formats });
          const loop = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              if (codes[0]?.rawValue) return found(codes[0].rawValue);
            } catch {}
            timer = setTimeout(loop, 120);
          };
          loop();
        } else {
          // Navegadores sin detector (p. ej. iPhone): librería ZXing, solo se descarga aquí
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          zxing = await reader.decodeFromVideoElement(video, (result) => {
            if (result) found(result.getText());
          });
          if (stopped) zxing.stop();
        }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : e instanceof Error ? e.message : "";
        setStarting(false);
        setError(
          name === "NotAllowedError"
            ? "No hay permiso para usar la cámara. Actívalo en el candado de la barra de direcciones y vuelve a intentar."
            : name === "NotFoundError" || name === "sin-camara"
              ? "No encontramos una cámara en este dispositivo."
              : "No se pudo abrir la cámara. Escribe el código abajo.",
        );
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      zxing?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function toggleTorch() {
    const t = trackRef.current;
    if (!t) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Escanear código de barras">
      <div className="flex items-center justify-between p-3">
        <p className="font-semibold">📷 Apunta al código de barras</p>
        <button className="rounded-full bg-white/15 px-3 py-1.5 text-sm" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-40 w-[80%] max-w-md rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
              <div className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse bg-red-500" />
            </div>
          </div>
        )}
        {starting && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/80">Abriendo cámara…</p>}
        {error && <p className="absolute inset-x-4 top-1/3 rounded-lg bg-red-600/90 p-3 text-center text-sm">{error}</p>}
      </div>
      <form
        className="flex gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) onDetectedRef.current(manual.trim());
        }}
      >
        {torchAvailable && (
          <button type="button" onClick={toggleTorch} className="rounded-lg bg-white/15 px-3 text-xl" aria-label="Linterna">
            {torch ? "🔦" : "💡"}
          </button>
        )}
        <input
          className="min-w-0 flex-1 rounded-lg bg-white px-3 py-2 text-black"
          inputMode="numeric"
          placeholder="O escribe el código"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button className="rounded-lg bg-white px-4 font-semibold text-black" disabled={!manual.trim()}>
          Buscar
        </button>
      </form>
    </div>
  );
}
