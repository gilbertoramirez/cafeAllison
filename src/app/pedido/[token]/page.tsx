import Link from "next/link";
import { notFound } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import { dateTime, money } from "@/lib/format";
import { getOrderByToken, getOrderItems, orderCode } from "@/lib/orders";
import { refreshStripeOrder } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { ORDER_STATUS_LABEL, PAYMENT_LABEL, type OrderStatus } from "@/lib/types";
import { siteUrl } from "@/lib/url";
import { orderMessage, waLink } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

const STEPS: OrderStatus[] = ["nuevo", "preparando", "listo", "en_camino", "entregado"];

export default async function OrderPage({ params, searchParams }: PageProps<"/pedido/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  let order = await getOrderByToken(token);
  if (!order) notFound();

  if (order.payment_method === "stripe" && order.payment_status !== "pagado") {
    await refreshStripeOrder(order);
    order = (await getOrderByToken(token))!;
  }

  const [items, settings, base] = await Promise.all([getOrderItems(order.id), getSettings(), siteUrl()]);
  const trackUrl = `${base}/pedido/${order.token}`;
  const steps: OrderStatus[] = order.delivery_type === "domicilio" ? STEPS.filter((s) => s !== "listo") : STEPS.filter((s) => s !== "en_camino");
  const current = steps.indexOf(order.status);
  const whatsapp = settings.whatsapp_number ? waLink(settings.whatsapp_number, orderMessage(order, items, trackUrl)) : null;
  const finished = order.status === "entregado" || order.status === "cancelado";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-8">
      {!finished && <AutoRefresh seconds={20} />}
      <Link href="/" className="text-sm text-cafe-700 underline">
        ← {settings.business_name}
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Pedido {orderCode(order.id)}</h1>
        <p className="text-sm text-cafe-600">{dateTime(order.created_at)}</p>
      </div>

      {sp.pago === "ok" && order.payment_status === "pagado" && (
        <p className="rounded-lg bg-green-50 p-3 text-green-800">¡Pago recibido! Ya estamos preparando tu pedido.</p>
      )}
      {sp.pago === "ok" && order.payment_status !== "pagado" && order.status !== "cancelado" && (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">Estamos confirmando tu pago, esta página se actualizará sola.</p>
      )}
      {sp.pago === "cancelado" && order.payment_status !== "pagado" && (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
          El pago no se completó. Si quieres, vuelve al menú y elige otra forma de pago.
        </p>
      )}

      {order.channel === "whatsapp" && whatsapp && (
        <div className="card space-y-2 border-[#25D366]">
          <p className="text-sm">
            {sp.wa ? "Último paso: " : ""}envíanos tu pedido por WhatsApp para confirmarlo y acordar el pago.
          </p>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn-whatsapp w-full py-3 text-base">
            💬 Enviar pedido por WhatsApp
          </a>
        </div>
      )}

      <section className="card">
        {order.status === "cancelado" ? (
          <p className="font-medium text-red-700">Este pedido fue cancelado.</p>
        ) : (
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    i <= current ? "bg-cafe-800 text-white" : "bg-cafe-100 text-cafe-500"
                  }`}
                >
                  {i < current ? "✓" : i + 1}
                </span>
                <span className={i === current ? "font-semibold" : i < current ? "text-cafe-600" : "text-cafe-400"}>
                  {ORDER_STATUS_LABEL[s]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card space-y-2 text-sm">
        {items.map((i) => (
          <div key={i.id} className="flex justify-between">
            <span>
              {i.qty} × {i.name}
            </span>
            <span>{money(i.unit_price * i.qty)}</span>
          </div>
        ))}
        {order.delivery_type === "domicilio" && (
          <div className="flex justify-between text-cafe-700">
            <span>Envío</span>
            <span>{order.delivery_fee > 0 ? money(order.delivery_fee) : "Gratis"}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-cafe-100 pt-2 text-base font-semibold">
          <span>Total</span>
          <span>{money(order.total)}</span>
        </div>
        <p className="text-cafe-700">
          {PAYMENT_LABEL[order.payment_method]} ·{" "}
          {order.payment_status === "pagado" ? (
            <span className="font-medium text-green-700">Pagado</span>
          ) : (
            <span>Pago pendiente</span>
          )}
        </p>
        <p className="text-cafe-700">
          {order.delivery_type === "domicilio"
            ? `Entrega en: ${order.address}${order.postal_code ? `, CP ${order.postal_code}` : ""}`
            : "Recoger en sucursal"}
        </p>
      </section>

      {order.channel !== "whatsapp" && whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full">
          ¿Dudas? Escríbenos por WhatsApp
        </a>
      )}
    </main>
  );
}
