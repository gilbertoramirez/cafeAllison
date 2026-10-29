import { PageTitle } from "@/components/admin/ui";
import { all } from "@/lib/db";
import { dateTime, localDate, money, startOfLocalDay } from "@/lib/format";
import { itemsForOrders, orderCode } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import type { Order, OrderStatus } from "@/lib/types";
import { ORDER_STATUS_LABEL, PAYMENT_LABEL } from "@/lib/types";
import { siteUrl } from "@/lib/url";
import { statusMessage, waLink } from "@/lib/whatsapp";
import { markPaid, updateOrderStatus } from "../../actions";
import PrintButton from "@/components/admin/PrintButton";
import CancelOrderControls from "@/components/admin/CancelOrderControls";

const FILTERS = {
  activos: "Activos",
  hoy: "Hoy",
  caja: "Caja hoy",
  canceladas: "Canceladas",
  todos: "Últimos 200",
} as const;

const STATUS_COLOR: Record<OrderStatus, string> = {
  nuevo: "bg-blue-100 text-blue-800",
  preparando: "bg-amber-100 text-amber-800",
  listo: "bg-purple-100 text-purple-800",
  en_camino: "bg-indigo-100 text-indigo-800",
  entregado: "bg-green-100 text-green-800",
  cancelado: "bg-gray-200 text-gray-600",
};

function nextSteps(o: Order): OrderStatus[] {
  if (o.status === "entregado" || o.status === "cancelado") return [];
  const flow: OrderStatus[] =
    o.delivery_type === "domicilio" ? ["nuevo", "preparando", "en_camino", "entregado"] : ["nuevo", "preparando", "listo", "entregado"];
  const i = flow.indexOf(o.status);
  return flow.slice(i + 1, i + 2);
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const f = ((await searchParams).f ?? "activos") as keyof typeof FILTERS;
  const today = startOfLocalDay(localDate());
  const where =
    f === "hoy"
      ? ["created_at >= ?", [today]]
      : f === "caja"
        ? ["channel = 'mostrador' AND created_at >= ?", [today]]
        : f === "canceladas"
          ? ["status = 'cancelado'", []]
          : f === "todos"
            ? ["1=1", []]
            : ["status NOT IN ('entregado','cancelado')", []];
  const orders = await all<Order>(`SELECT * FROM orders WHERE ${where[0]} ORDER BY created_at DESC LIMIT 200`, where[1] as string[]);
  const [items, settings, base] = await Promise.all([itemsForOrders(orders.map((o) => o.id)), getSettings(), siteUrl()]);

  return (
    <div>
      <PageTitle
        actions={
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {Object.entries(FILTERS).map(([k, l]) => (
              <a
                key={k}
                href={`?f=${k}`}
                className={`shrink-0 rounded-full px-3 py-1 text-sm ${f === k ? "bg-cafe-800 text-white" : "bg-white ring-1 ring-cafe-200"}`}
              >
                {l}
              </a>
            ))}
          </div>
        }
      >
        Pedidos
      </PageTitle>

      {orders.length === 0 && <p className="text-cafe-600">No hay pedidos aquí.</p>}

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {orders.map((o) => {
          const its = items.get(o.id) ?? [];
          const track = `${base}/pedido/${o.token}`;
          return (
            <article key={o.id} className="card space-y-3 text-sm">
              <header className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold">
                    {orderCode(o.id)} {o.customer_name && `· ${o.customer_name}`}
                  </p>
                  <p className="text-xs text-cafe-600">
                    {dateTime(o.created_at)} ·{" "}
                    {o.channel === "mostrador"
                      ? "🧾 Venta en caja"
                      : `${o.channel === "whatsapp" ? "WhatsApp" : "Web"} · ${o.delivery_type === "domicilio" ? "🛵 Domicilio" : "🏪 Recoger"}`}
                  </p>
                </div>
                <span className={`badge ${STATUS_COLOR[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
              </header>

              <ul>
                {its.map((i) => (
                  <li key={i.id} className="flex justify-between">
                    <span>
                      {i.qty} × {i.name}
                      {i.notes && <span className="block text-xs text-amber-800">↳ {i.notes}</span>}
                    </span>
                    <span className="tabular-nums">{money(i.unit_price * i.qty)}</span>
                  </li>
                ))}
                {o.delivery_type === "domicilio" && (
                  <li className="flex justify-between text-cafe-600">
                    <span>Envío</span>
                    <span>{o.delivery_fee > 0 ? money(o.delivery_fee) : "Gratis"}</span>
                  </li>
                )}
                <li className="mt-1 flex justify-between border-t border-cafe-100 pt-1 font-semibold">
                  <span>Total</span>
                  <span>{money(o.total)}</span>
                </li>
              </ul>

              <p>
                {PAYMENT_LABEL[o.payment_method]} ·{" "}
                {o.payment_status === "pagado" ? (
                  <span className="font-medium text-green-700">Pagado</span>
                ) : (
                  <span className="font-medium text-amber-700">Por cobrar</span>
                )}
                {o.cash_given ? ` · Paga con ${money(o.cash_given)} (cambio ${money(o.cash_given - o.total)})` : ""}
              </p>

              {o.delivery_type === "domicilio" && (
                <div className="rounded-lg bg-cafe-50 p-2">
                  <p>
                    📍 {o.address}
                    {o.postal_code && <span className="text-cafe-600"> · CP {o.postal_code}</span>}
                  </p>
                  {o.address_ref && <p className="text-cafe-600">{o.address_ref}</p>}
                  <a
                    className="text-cafe-700 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={
                      o.lat != null
                        ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address, o.postal_code].filter(Boolean).join(", "))}`
                    }
                  >
                    Abrir en mapa
                  </a>
                </div>
              )}
              {o.notes && <p className="rounded-lg bg-amber-50 p-2">📝 {o.notes}</p>}
              {o.status === "cancelado" && (
                <p className="rounded-lg bg-gray-100 p-2 text-gray-700">
                  ✖ Cancelada{o.cancelled_at ? ` el ${dateTime(o.cancelled_at)}` : ""}
                  {o.cancel_reason ? ` · ${o.cancel_reason}` : ""}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {nextSteps(o).map((s) => (
                  <form key={s} action={updateOrderStatus.bind(null, o.id, s)}>
                    <button className="btn-primary">→ {ORDER_STATUS_LABEL[s]}</button>
                  </form>
                ))}
                {o.payment_status !== "pagado" && o.status !== "cancelado" && (
                  <form action={markPaid.bind(null, o.id)}>
                    <button className="btn-secondary">💵 Marcar pagado</button>
                  </form>
                )}
                <PrintButton orderId={o.id} />
                {o.phone && (
                  <a
                    className="btn-whatsapp"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={waLink(o.phone, statusMessage(o, settings.business_name, track))}
                  >
                    WhatsApp
                  </a>
                )}
                <CancelOrderControls
                  orderId={o.id}
                  cancelled={o.status === "cancelado"}
                  paidOnline={o.payment_method === "stripe" && o.payment_status === "pagado"}
                />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
