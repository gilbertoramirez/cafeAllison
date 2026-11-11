/**
 * Fotos de productos en Vercel Blob (almacenamiento de archivos aparte de la base de datos).
 * En la base solo se guarda el link de la foto.
 */
import { del, put } from "@vercel/blob";
import { all, get, run } from "./db";

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** ¿El link es una foto que subimos nosotros (y por lo tanto la podemos borrar)? */
function isOurBlob(url: string) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".public.blob.vercel-storage.com") || u.hostname.endsWith(".blob.vercel-storage.com")) return true;
    const test = process.env.BLOB_TEST_PUBLIC_BASE; // solo para pruebas locales con un Blob simulado
    return Boolean(test && url.startsWith(test));
  } catch {
    return false;
  }
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "producto";

export const MAX_IMAGE_BYTES = 1_500_000;
export const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"];

/** Sube una foto (ya comprimida en el navegador) y devuelve su link público. */
export async function uploadProductImage(file: Blob, name: string): Promise<string> {
  const ext = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
  const r = await put(`productos/${slug(name)}.${ext}`, file, {
    access: "public",
    contentType: file.type,
    addRandomSuffix: true,
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });
  return r.url;
}

/**
 * Pone (o quita, con url vacío) la foto en el producto y en todos sus tamaños (mismo nombre).
 * Las fotos anteriores que ya nadie usa se borran del almacenamiento.
 */
export async function setProductPhoto(productId: number, url: string) {
  const p = await get<{ name: string }>("SELECT name FROM products WHERE id = ?", [productId]);
  if (!p) return;
  const old = await all<{ image_url: string }>("SELECT DISTINCT image_url FROM products WHERE name = ? AND image_url <> ''", [p.name]);
  await run("UPDATE products SET image_url = ? WHERE name = ?", [url, p.name]);
  await cleanupImages(old.map((o) => o.image_url).filter((u) => u !== url));
}

/** Borra del almacenamiento las fotos nuestras que ya no usa ningún producto. */
export async function cleanupImages(urls: string[]) {
  const ours = urls.filter(isOurBlob);
  if (!ours.length || !blobEnabled()) return;
  const used = await all<{ image_url: string }>(
    `SELECT DISTINCT image_url FROM products WHERE image_url IN (${ours.map(() => "?").join(",")})`,
    ours,
  );
  const orphan = ours.filter((u) => !used.some((x) => x.image_url === u));
  if (orphan.length) await del(orphan).catch((e) => console.error("blob", e));
}
