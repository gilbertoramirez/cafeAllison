/**
 * Fotos de productos en Vercel Blob (almacenamiento de archivos aparte de la base de datos).
 * En la base solo se guarda el link de la foto.
 */
import { BlobAccessError, BlobError, BlobStoreNotFoundError, BlobStoreSuspendedError, del, get as getBlob, put } from "@vercel/blob";
import { all, get, run } from "./db";
import { setSetting } from "./settings";

/** Fotos de un almacenamiento privado: la página las sirve en /api/foto?u=… */
const PROXY = "/api/foto?u=";
export const proxiedUrl = (blobUrl: string) => PROXY + encodeURIComponent(blobUrl);
const unproxy = (url: string) => (url.startsWith(PROXY) ? decodeURIComponent(url.slice(PROXY.length)) : url);

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** ¿El link es una foto que subimos nosotros (y por lo tanto la podemos borrar)? */
export function isOurBlob(link: string) {
  const url = unproxy(link);
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

export class ImageUploadError extends Error {}

/** Mensaje claro según el error que devuelve Vercel Blob. */
function explain(e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e);
  if (e instanceof BlobAccessError) {
    return `Vercel rechazó el acceso al almacenamiento de fotos. Revisa que el Blob esté conectado a este proyecto (Production) y vuelve a publicar con Redeploy. Detalle: ${detail}`;
  }
  if (e instanceof BlobStoreNotFoundError) return `No se encontró el almacenamiento de fotos (¿se borró?). Detalle: ${detail}`;
  if (e instanceof BlobStoreSuspendedError) return `El almacenamiento de fotos está suspendido en Vercel (revisa tu plan o límites). Detalle: ${detail}`;
  return `No se pudo guardar la foto. Detalle: ${detail}`;
}

/**
 * Sube una foto (ya comprimida en el navegador) y devuelve el link para mostrarla.
 * Funciona con almacenamiento público (link directo) o privado (la página la sirve).
 */
export async function uploadProductImage(file: Blob, name: string): Promise<string> {
  const ext = file.type === "image/webp" ? "webp" : file.type === "image/png" ? "png" : "jpg";
  const pathname = `productos/${slug(name)}.${ext}`;
  const opts = { contentType: file.type, addRandomSuffix: true, cacheControlMaxAge: 60 * 60 * 24 * 365 };
  const mode = (await get<{ value: string }>("SELECT value FROM settings WHERE key = 'blob_access'"))?.value;
  if (mode !== "private") {
    try {
      return (await put(pathname, file, { ...opts, access: "public" })).url;
    } catch (e) {
      // Un almacenamiento privado no acepta fotos públicas: se intenta como privada
      if (!(e instanceof BlobError) || e instanceof BlobStoreNotFoundError || e instanceof BlobStoreSuspendedError) {
        throw new ImageUploadError(explain(e));
      }
      try {
        const r = await put(pathname, file, { ...opts, access: "private" });
        await setSetting("blob_access", "private");
        return proxiedUrl(r.url);
      } catch {
        throw new ImageUploadError(explain(e));
      }
    }
  }
  try {
    return proxiedUrl((await put(pathname, file, { ...opts, access: "private" })).url);
  } catch (e) {
    throw new ImageUploadError(explain(e));
  }
}

/** Lee una foto de un almacenamiento privado (para /api/foto). */
export async function readPrivateImage(blobUrl: string) {
  if (!isOurBlob(blobUrl) || !blobEnabled()) return null;
  const r = await getBlob(blobUrl, { access: "private" });
  return r && r.statusCode === 200 ? r : null;
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
  const ours = urls.filter((u) => isOurBlob(u));
  if (!ours.length || !blobEnabled()) return;
  const marks = ours.map(() => "?").join(",");
  const used = await all<{ image_url: string }>(
    `SELECT image_url FROM products WHERE image_url IN (${marks})
     UNION SELECT image_url FROM category_images WHERE image_url IN (${marks})`,
    [...ours, ...ours],
  );
  const orphan = ours.filter((u) => !used.some((x) => x.image_url === u));
  if (orphan.length) await del(orphan.map(unproxy)).catch((e) => console.error("blob", e));
}

/** Pone (o quita, con url vacío) la foto de una categoría del menú. */
export async function setCategoryPhoto(category: string, url: string) {
  const old = await get<{ image_url: string }>("SELECT image_url FROM category_images WHERE category = ?", [category]);
  if (url) {
    await run(
      `INSERT INTO category_images (category, image_url) VALUES (?, ?)
       ON CONFLICT (category) DO UPDATE SET image_url = excluded.image_url`,
      [category, url],
    );
  } else {
    await run("DELETE FROM category_images WHERE category = ?", [category]);
  }
  if (old && old.image_url !== url) await cleanupImages([old.image_url]);
}

export async function categoryImages(): Promise<Record<string, string>> {
  const rows = await all<{ category: string; image_url: string }>("SELECT category, image_url FROM category_images");
  return Object.fromEntries(rows.map((r) => [r.category, r.image_url]));
}
