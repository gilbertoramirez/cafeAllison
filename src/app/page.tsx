import Link from "next/link";
import { all } from "@/lib/db";
import { getSettings, stripeEnabled } from "@/lib/settings";
import { availableToday } from "@/lib/format";
import { daysLabel, type Product } from "@/lib/types";
import Shop from "@/components/Shop";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [settings, products] = await Promise.all([
    getSettings(),
    all<Product>("SELECT * FROM products WHERE active = 1 ORDER BY (SELECT MIN(p2.sort) FROM products p2 WHERE p2.category = products.category), category, sort, name"),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-cafe-900 text-cafe-50">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <h1 className="text-3xl font-bold tracking-tight">{settings.business_name}</h1>
          <p className="mt-1 text-cafe-200">
            {settings.hours}
            {settings.address ? ` · ${settings.address}` : ""}
          </p>
          {!settings.store_open && (
            <p className="mt-3 inline-block rounded-lg bg-red-600 px-3 py-1 text-sm font-medium">
              Por ahora no estamos recibiendo pedidos en línea.
            </p>
          )}
        </div>
      </header>
      <Shop
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          size: p.size,
          notToday: availableToday(p.available_days) ? null : `Solo ${daysLabel(p.available_days)}`,
          description: p.description,
          category: p.category,
          price: p.price,
          image_url: p.image_url,
          soldOut: Boolean(p.track_stock) && p.stock <= 0,
          maxQty: p.track_stock ? Math.max(p.stock, 0) : 99,
        }))}
        settings={{
          open: settings.store_open,
          deliveryEnabled: settings.delivery_enabled,
          deliveryFee: settings.delivery_fee,
          minDeliveryOrder: settings.min_delivery_order,
          whatsapp: Boolean(settings.whatsapp_number),
          stripe: stripeEnabled(),
        }}
      />
      <footer className="mt-auto border-t border-cafe-100 py-6 text-center text-xs text-cafe-600">
        {settings.business_name} · <Link href="/admin" className="underline">Administración</Link>
      </footer>
    </div>
  );
}
