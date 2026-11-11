import { slotLabel } from "@/lib/schedule";
import { PageTitle } from "@/components/admin/ui";
import RoutePlanner from "@/components/admin/RoutePlanner";
import { all } from "@/lib/db";
import { itemsForOrders, orderCode } from "@/lib/orders";
import { getSettings } from "@/lib/settings";
import { mapsEnabled } from "@/lib/maps";
import type { Order } from "@/lib/types";
import { deliverOrder, markOrdersOnTheWay, planDeliveryRoute } from "../../actions";

export const dynamic = "force-dynamic";

export default async function DeliveryRoutePage() {
  const [settings, orders] = await Promise.all([
    getSettings(),
    all<Order>(
      `SELECT * FROM orders WHERE delivery_type = 'domicilio' AND status IN ('nuevo', 'preparando', 'en_camino')
       ORDER BY created_at`,
    ),
  ]);
  const items = await itemsForOrders(orders.map((o) => o.id));
  return (
    <div className="max-w-3xl space-y-4">
      <PageTitle>Reparto</PageTitle>
      <p className="-mt-2 text-sm text-cafe-600">
        Elige los pedidos a domicilio que salen juntos y calcula el mejor orden de entrega.
        {!mapsEnabled() && " Sin Google Maps configurado el orden es aproximado."}
        {!settings.cafe_location && !settings.address && " Primero configura la ubicación de la cafetería en Ajustes."}
      </p>
      <RoutePlanner
        businessName={settings.business_name}
        actions={{ plan: planDeliveryRoute, onTheWay: markOrdersOnTheWay, delivered: deliverOrder }}
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
    </div>
  );
}
