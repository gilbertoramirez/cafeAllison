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
