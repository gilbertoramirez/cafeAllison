import { slotLabel } from "@/lib/schedule";
import AutoRefresh from "@/components/AutoRefresh";
import RoutePlanner from "@/components/admin/RoutePlanner";
import { all } from "@/lib/db";
import { requireDriver } from "@/lib/drivers";
import { localDate, money } from "@/lib/format";
import { itemsForOrders, orderCode } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import type { Order } from "@/lib/types";
import { driverDelivered, driverOnTheWay, driverPlanRoute } from "../actions";

/** Pantalla del repartidor: solo pedidos a domicilio activos y sus entregas del día. */
export default async function DriverHome() {
  const driver = await requireDriver();
  const [settings, orders, mine] = await Promise.all([
    getSettings(),
    all<Order>(
      `SELECT * FROM orders WHERE delivery_type = 'domicilio' AND status IN ('nuevo', 'preparando', 'en_camino')
       ORDER BY created_at`,
    ),
    all<{ id: number; customer_name: string; total: number; payment_method: string; paid_at: string | null; created_at: string; collected: number }>(
      `SELECT id, customer_name, total, payment_method, paid_at, created_at,
              CASE WHEN payment_method <> 'stripe' THEN total ELSE 0 END AS collected
       FROM orders WHERE driver_id = ? AND status = 'entregado' ORDER BY id DESC LIMIT 50`,
      [driver.id],
    ),
  ]);
  const today = localDate();
  const todays = mine.filter((o) => localDate(new Date(o.paid_at ?? o.created_at)) === today);
  const cash = todays.reduce((a, o) => a + o.collected, 0);
  const items = await itemsForOrders(orders.map((o) => o.id));

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={30} />
      <h1 className="text-2xl font-bold">Pedidos a domicilio</h1>
      <RoutePlanner
        businessName={settings.business_name}
        actions={{ plan: driverPlanRoute, onTheWay: driverOnTheWay, delivered: driverDelivered }}
        orders={orders.map((o) => ({
          id: o.id,
          code: orderCode(o.id),
          name: o.customer_name,
          address: o.address,
          status: o.status,
          km: o.delivery_km,
          total: o.total,
          paid: o.payment_status === "pagado",
          items: (items.get(o.id) ?? []).map((i) => `${i.qty} × ${i.name}`).join(", "),
          createdAt: o.created_at,
          scheduled: o.scheduled_for ? slotLabel(o.scheduled_for) : null,
        }))}
      />
      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Mis entregas de hoy</h2>
        {todays.length === 0 ? (
          <p className="text-cafe-600">Todavía no has entregado pedidos hoy.</p>
        ) : (
          <>
            <ul className="divide-y divide-cafe-100">
              {todays.map((o) => (
                <li key={o.id} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {orderCode(o.id)} · {o.customer_name}
                  </span>
                  <span className="text-cafe-700">{o.collected ? `Cobrado ${money(o.collected)}` : "Pagado en línea"}</span>
                </li>
              ))}
            </ul>
            <p className="font-semibold">Efectivo a entregar en caja: {money(cash)}</p>
          </>
        )}
      </section>
    </div>
  );
}
