"use client";

import { useRef, useState } from "react";
import { removeProductPhoto } from "@/app/admin/actions";

const SIZE = 800; // px del lado de la foto cuadrada

/** Recorta al centro en cuadrado, reduce a 800×800 y comprime (WebP o JPG) en el navegador. */
async function squareAndCompress(file: File): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo leer la foto"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width;
  const h = source.height;
  const side = Math.min(w, h);
  const out = Math.min(SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out, out);
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  const webp = await toBlob("image/webp", 0.8);
  if (webp && webp.type === "image/webp") return webp;
  const jpg = await toBlob("image/jpeg", 0.82);
  if (!jpg) throw new Error("No se pudo comprimir la foto");
  return jpg;
}

export default function ProductPhotoInput({
  productId,
  productName,
  defaultUrl,
  enabled,
}: {
  productId: number | null;
  productName: string;
  defaultUrl: string;
  enabled: boolean;
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg({ ok: true, text: "Preparando foto…" });
    try {
      const blob = await squareAndCompress(file);
      setMsg({ ok: true, text: `Subiendo (${Math.round(blob.size / 1024)} KB)…` });
      const fd = new FormData();
      fd.append("file", blob, "foto");
      if (productId) fd.append("productId", String(productId));
      fd.append("name", productName);
      const res = await fetch("/api/admin/imagen", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir la foto");
      setUrl(data.url);
      setMsg({
        ok: true,
        text: data.applied
          ? "✓ Foto guardada (en todos los tamaños de este producto)."
          : "✓ Foto lista. Toca Guardar para crear el producto.",
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo subir la foto" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove() {
    if (!confirm("¿Quitar la foto de este producto (en todos sus tamaños)?")) return;
    setBusy(true);
    try {
      if (productId) await removeProductPhoto(productId);
      setUrl("");
      setMsg({ ok: true, text: "Foto quitada. Se mostrará el ícono." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cafe-100 text-3xl">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            "📷"
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? "Subiendo…" : url ? "📷 Cambiar foto" : "📷 Tomar o subir foto"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </>
          ) : (
            <p className="text-xs text-amber-700">
              Para subir fotos activa el almacenamiento de fotos (Vercel Blob) del proyecto. Mientras tanto puedes pegar un link.
            </p>
          )}
          {url && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={remove}>
              Quitar foto
            </button>
          )}
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
      <details className="text-xs text-cafe-600">
        <summary className="cursor-pointer">O pega el link de una foto</summary>
        <input
          name="image_url"
          type="url"
          className="input mt-1"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </details>
    </div>
  );
}
