import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { get } from "@/lib/db";
import { blobEnabled, IMAGE_TYPES, ImageUploadError, MAX_IMAGE_BYTES, setCategoryPhoto, setProductPhoto, uploadProductImage } from "@/lib/images";

export const dynamic = "force-dynamic";

/** Sube la foto de un producto (desde Admin → Menú). Si llega productId se aplica a todos sus tamaños. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!blobEnabled()) {
    return NextResponse.json(
      { error: "Falta activar el almacenamiento de fotos (Vercel Blob) en el proyecto." },
      { status: 503 },
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "No llegó la foto." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || !IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "El archivo debe ser una foto (JPG, PNG o WebP)." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La foto es demasiado pesada." }, { status: 413 });
  const category = String(form.get("category") ?? "").trim().slice(0, 80);
  const productId = Number(form.get("productId")) || null;
  const product = productId ? await get<{ name: string }>("SELECT name FROM products WHERE id = ?", [productId]) : null;
  const name = product?.name ?? (category ? `categoria-${category}` : String(form.get("name") ?? "producto"));
  try {
    const url = await uploadProductImage(file, name);
    if (category) {
      await setCategoryPhoto(category, url);
      return NextResponse.json({ url, applied: true });
    }
    if (product && productId) await setProductPhoto(productId, url);
    return NextResponse.json({ url, applied: Boolean(product) });
  } catch (e) {
    console.error("blob", e);
    const message = e instanceof ImageUploadError ? e.message : `No se pudo guardar la foto. Detalle: ${e instanceof Error ? e.message : e}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
