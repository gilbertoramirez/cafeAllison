import { onlinePrice } from "@/lib/fees";
import { money } from "@/lib/format";
import { all } from "@/lib/db";
import { getDeliveryRules, getSettings, stripeEnabled } from "@/lib/settings";
import { availableToday } from "@/lib/format";
import { daysLabel, type Product } from "@/lib/types";
import Shop from "@/components/Shop";
import { ActiveOrderBanner } from "@/components/MyOrders";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [settings, products, delivery] = await Promise.all([
    getSettings(),
    all<Product>(
      "SELECT * FROM products WHERE active = 1 ORDER BY (SELECT MIN(p2.sort) FROM products p2 WHERE p2.category = products.category), category, sort, name",
    ),
    getDeliveryRules(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      {!settings.store_open && (
        <p className="bg-red-50 px-4 py-2 text-center text-sm font-medium text-red-700">
          Por ahora no estamos recibiendo pedidos en línea.
        </p>
      )}
      {settings.store_open &&
        settings.delivery_enabled &&
        delivery.freeFrom > 0 && (
          <p className="bg-cafe-100 px-4 py-2 text-center text-sm text-cafe-800">
            🛵 Envío gratis en pedidos desde {money(delivery.freeFrom)}
          </p>
        )}
      <ActiveOrderBanner />
      <Shop
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          size: p.size,
          icon: p.icon,
          notToday: availableToday(p.available_days)
            ? null
            : `Solo ${daysLabel(p.available_days)}`,
          description: p.description,
          category: p.category,
          price: p.price,
          // El menú muestra el precio con la comisión del pago en línea; en efectivo o para recoger baja al normal
          menuPrice: stripeEnabled()
            ? onlinePrice(p.price, settings.online_fee)
            : p.price,
          image_url: p.image_url,
          soldOut: Boolean(p.track_stock) && p.stock <= 0,
          maxQty: p.track_stock ? Math.max(p.stock, 0) : 99,
        }))}
        settings={{
          open: settings.store_open,
          deliveryEnabled: settings.delivery_enabled,
          delivery,
          minDeliveryOrder: settings.min_delivery_order,
          whatsapp: Boolean(settings.whatsapp_number),
          stripe: stripeEnabled(),
          onlineFee: settings.online_fee,
          loyalty: settings.loyalty,
        }}
      />
    </div>
  );
}
