import { onlinePrice } from "@/lib/fees";
import { money } from "@/lib/format";
import { all } from "@/lib/db";
import { getDeliveryRules, getSettings, stripeEnabled } from "@/lib/settings";
import { availableToday } from "@/lib/format";
import { daysLabel, type Product } from "@/lib/types";
import Shop from "@/components/Shop";
import { applyDuePriceChanges } from "@/lib/priceChanges";
import { getUpsellData } from "@/lib/upsell";
import { categoryImages } from "@/lib/images";
import { ActiveOrderBanner } from "@/components/MyOrders";

// ISR: la CDN sirve esta página ya generada. Se regenera como máximo cada 60 s
// y al instante cuando el panel guarda un cambio (revalidatePath en las acciones).
export const revalidate = 60;

export default async function Home() {
  await applyDuePriceChanges(); // precios programados que ya tocan
  const [settings, products, delivery, upsell, catImages] = await Promise.all([
    getSettings(),
    all<Product>(
      "SELECT * FROM products WHERE active = 1 AND pos_only = 0 ORDER BY (SELECT MIN(p2.sort) FROM products p2 WHERE p2.category = products.category), category, sort, name",
    ),
    getDeliveryRules(),
    getUpsellData(),
    categoryImages(),
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
          schedule: settings.schedule,
        }}
        upsell={upsell}
        categoryImages={catImages}
      />
    </div>
  );
}
