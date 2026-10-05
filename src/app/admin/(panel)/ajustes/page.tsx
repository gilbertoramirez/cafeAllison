import { Field, PageTitle } from "@/components/admin/ui";
import { centsToInput } from "@/lib/format";
import { getSettings, stripeEnabled } from "@/lib/settings";
import { saveSettings } from "../../actions";

export default async function SettingsPage() {
  const s = await getSettings();
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle>Ajustes</PageTitle>
      <form action={saveSettings} className="card grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del negocio" className="sm:col-span-2">
          <input name="business_name" className="input" defaultValue={s.business_name} required />
        </Field>
        <Field label="WhatsApp del negocio" hint="10 dígitos, ej. 5512345678. Los pedidos por WhatsApp llegan aquí.">
          <input name="whatsapp_number" className="input" defaultValue={s.whatsapp_number} inputMode="tel" />
        </Field>
        <Field label="Horario">
          <input name="hours" className="input" defaultValue={s.hours} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <input name="address" className="input" defaultValue={s.address} />
        </Field>
        <Field label="Costo de envío ($)">
          <input name="delivery_fee" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(s.delivery_fee)} />
        </Field>
        <Field label="Pedido mínimo a domicilio ($)">
          <input
            name="min_delivery_order"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={centsToInput(s.min_delivery_order)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="store_open" defaultChecked={s.store_open} /> Recibir pedidos en línea
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="delivery_enabled" defaultChecked={s.delivery_enabled} /> Ofrecer entrega a domicilio
        </label>
        <div className="sm:col-span-2">
          <button className="btn-primary">Guardar ajustes</button>
        </div>
      </form>

      <div className="card space-y-1 text-sm">
        <h2 className="font-semibold">Pagos en línea (Stripe)</h2>
        {stripeEnabled() ? (
          <p className="text-green-700">✓ Stripe está configurado. Tus clientes pueden pagar con tarjeta.</p>
        ) : (
          <p className="text-cafe-700">
            No configurado. Agrega <code>STRIPE_SECRET_KEY</code> y <code>STRIPE_WEBHOOK_SECRET</code> en las variables de
            entorno (ver README). Mientras tanto los clientes pueden pagar en efectivo o por WhatsApp.
          </p>
        )}
      </div>
    </div>
  );
}
