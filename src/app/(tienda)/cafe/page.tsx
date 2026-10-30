import type { Metadata } from "next";
import Link from "next/link";
import { money } from "@/lib/format";
import { getDeliveryRules, getSettings, stripeEnabled } from "@/lib/settings";
import { waLink } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "El café · Café Allison" };

export default async function CafePage() {
  const [settings, delivery] = await Promise.all([
    getSettings(),
    getDeliveryRules(),
  ]);
  const maps = settings.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${settings.business_name}, ${settings.address}`)}`
    : null;
  const payments = [
    stripeEnabled() && "💳 Tarjeta en línea",
    "💵 Efectivo",
    settings.whatsapp_number && "💬 Pedido por WhatsApp",
  ].filter(Boolean) as string[];

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-5">
      <h1 className="text-2xl font-bold">{settings.business_name}</h1>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        {settings.hours && (
          <Info icon="🕒" title="Horario" text={settings.hours} />
        )}
        {settings.address && (
          <Info icon="📍" title="Dirección" text={settings.address} />
        )}
        {(maps || settings.whatsapp_number) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {maps && (
              <a
                href={maps}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary flex-1"
              >
                🗺️ Cómo llegar
              </a>
            )}
            {settings.whatsapp_number && (
              <a
                href={waLink(
                  settings.whatsapp_number,
                  `¡Hola ${settings.business_name}! `,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-whatsapp flex-1"
              >
                💬 Escríbenos
              </a>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-bold">Entregas</h2>
        <Info
          icon="🏪"
          title="Para recoger"
          text="Pide en línea y pasa por tu pedido; te avisamos cuando esté listo."
        />
        {settings.delivery_enabled ? (
          <>
            <Info
              icon="🛵"
              title="A domicilio"
              text={
                delivery.zones.length
                  ? "El costo depende de tu código postal:"
                  : `Costo de envío: ${delivery.flatFee ? money(delivery.flatFee) : "gratis"}`
              }
            />
            {delivery.zones.length > 0 && (
              <ul className="divide-y divide-cafe-100 rounded-xl bg-cafe-50 px-3 text-sm">
                {delivery.zones.map((z) => (
                  <li key={z.id} className="flex justify-between gap-3 py-2">
                    <span>{z.name}</span>
                    <span className="font-semibold">
                      {z.fee ? money(z.fee) : "Gratis"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {delivery.freeFrom > 0 && (
              <p className="text-sm text-cafe-700">
                ✨ Envío gratis desde {money(delivery.freeFrom)}.
              </p>
            )}
            {settings.min_delivery_order > 0 && (
              <p className="text-sm text-cafe-700">
                Pedido mínimo a domicilio: {money(settings.min_delivery_order)}.
              </p>
            )}
          </>
        ) : (
          <Info
            icon="🛵"
            title="A domicilio"
            text="Por ahora solo tenemos pedidos para recoger."
          />
        )}
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="font-bold">Formas de pago</h2>
        <div className="flex flex-wrap gap-2">
          {payments.map((p) => (
            <span key={p} className="badge bg-cafe-100 text-cafe-800">
              {p}
            </span>
          ))}
        </div>
      </section>

      <p className="pt-2 text-center text-xs text-cafe-500">
        {settings.business_name} ·{" "}
        <Link href="/admin" className="underline">
          Administración
        </Link>
      </p>
    </main>
  );
}

function Info({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="text-xl">{icon}</span>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-cafe-700">{text}</p>
      </div>
    </div>
  );
}
