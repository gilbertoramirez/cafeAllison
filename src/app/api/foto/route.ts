import { readPrivateImage } from "@/lib/images";

export const dynamic = "force-dynamic";

/** Muestra una foto de producto guardada en un almacenamiento privado de Vercel Blob. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u") ?? "";
  const r = await readPrivateImage(u).catch((e) => {
    console.error("blob", e);
    return null;
  });
  if (!r) return new Response("No encontrada", { status: 404 });
  return new Response(r.stream, {
    headers: {
      "content-type": r.blob.contentType || "image/webp",
      // El nombre de cada foto es único: el navegador y la CDN la pueden guardar mucho tiempo
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
