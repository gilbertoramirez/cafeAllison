/** Pedidos hechos (o abiertos) desde este dispositivo, para "Mis pedidos". Solo navegador. */
const KEY = "cafe_my_orders_v1";
const MAX = 10;
export const MY_ORDERS_EVENT = "cafe-my-orders";

export type MyOrderRef = { token: string; at: number };

export function loadMyOrders(): MyOrderRef[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as MyOrderRef[];
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return Array.isArray(list) ? list.filter((o) => o?.token && o.at > weekAgo) : [];
  } catch {
    return [];
  }
}

export function rememberOrder(token: string) {
  try {
    const list = loadMyOrders().filter((o) => o.token !== token);
    list.unshift({ token, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(MY_ORDERS_EVENT));
  } catch {}
}

export function forgetOrder(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadMyOrders().filter((o) => o.token !== token)));
    window.dispatchEvent(new Event(MY_ORDERS_EVENT));
  } catch {}
}

/** Carrito de la tienda guardado en este dispositivo. */
export const CART_KEY = "cafe_cart_v2";

/** "Pedir de nuevo": agrega al carrito los productos de un pedido anterior. */
export function addToSavedCart(items: { productId: number | null; qty: number; note?: string }[]) {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]") as { key: string; productId: number; qty: number; note: string }[];
    for (const it of items) {
      if (!it.productId || it.qty <= 0) continue;
      const note = (it.note ?? "").trim();
      const key = `${it.productId}|${note}`;
      const line = cart.find((l) => l.key === key);
      if (line) line.qty += it.qty;
      else cart.push({ key, productId: it.productId, qty: it.qty, note });
    }
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {}
}
