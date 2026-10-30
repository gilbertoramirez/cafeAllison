import { Field, PageTitle } from "@/components/admin/ui";
import { centsToInput, money } from "@/lib/format";
import { getDeliveryRules, getSettings, stripeEnabled } from "@/lib/settings";
import { parseCps } from "@/lib/delivery";
import { onlinePrice } from "@/lib/fees";
import { deleteZone, saveOnlineFee, saveSettings, saveZone } from "../../actions";
import PrinterSettingsCard from "@/components/admin/PrinterSettingsCard";

export default async function SettingsPage() {
  const [s, delivery] = await Promise.all([getSettings(), getDeliveryRules()]);
  const zones = delivery.zones;
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
        <Field
          label="Costo de envío fijo ($)"
          hint={zones.length ? "No se usa: el envío se calcula por zonas (abajo)." : "Se usa mientras no configures zonas por código postal."}
        >
          <input name="delivery_fee" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(s.delivery_fee)} />
        </Field>
        <Field label="Envío gratis desde ($)" hint="Subtotal a partir del cual no se cobra envío. 0 = nunca gratis.">
          <input
            name="free_delivery_from"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={centsToInput(s.free_delivery_from)}
          />
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

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">🛵 Zonas de envío por código postal</h2>
          <p className="text-sm text-cafe-600">
            El cliente escribe su código postal y se cobra el envío de su zona. Si su código postal no está en ninguna zona, no
            se permite pedir a domicilio (solo recoger).
            {zones.length === 0 && " Mientras no agregues zonas, se cobra el costo de envío fijo a cualquier dirección."}
          </p>
        </div>

        {zones.map((z) => (
          <form key={z.id} action={saveZone} className="grid gap-2 rounded-lg border border-cafe-100 p-3 sm:grid-cols-[1fr_8rem]">
            <input type="hidden" name="id" value={z.id} />
            <Field label="Nombre de la zona">
              <input name="name" className="input" defaultValue={z.name} required />
            </Field>
            <Field label="Envío ($)">
              <input name="fee" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(z.fee)} />
            </Field>
            <Field label={`Códigos postales (${parseCps(z.postal_codes).length})`} className="sm:col-span-2">
              <textarea name="postal_codes" rows={2} className="input font-mono" defaultValue={z.postal_codes} required />
            </Field>
            <div className="flex gap-3 sm:col-span-2">
              <button className="btn-secondary">Guardar</button>
              <button formAction={deleteZone.bind(null, z.id)} formNoValidate className="text-sm text-red-700 underline">
                Eliminar zona
              </button>
            </div>
          </form>
        ))}

        <form action={saveZone} className="grid gap-2 rounded-lg border border-dashed border-cafe-300 p-3 sm:grid-cols-[1fr_8rem]">
          <p className="text-sm font-medium sm:col-span-2">+ Nueva zona</p>
          <Field label="Nombre de la zona">
            <input name="name" className="input" placeholder="Zona 1 · Centro" required />
          </Field>
          <Field label="Envío ($)">
            <input name="fee" type="number" step="0.01" min="0" className="input" placeholder="25" required />
          </Field>
          <Field label="Códigos postales" hint="Sepáralos con comas o espacios." className="sm:col-span-2">
            <textarea name="postal_codes" rows={2} className="input font-mono" placeholder="06000, 06010, 06020" required />
          </Field>
          <div className="sm:col-span-2">
            <button className="btn-primary">Agregar zona</button>
          </div>
        </form>

        {zones.length > 0 && (
          <p className="text-sm text-cafe-700">
            Resumen:{" "}
            {zones.map((z) => `${z.name} ${money(z.fee)}`).join(" · ")}
            {delivery.freeFrom > 0 && ` · Gratis desde ${money(delivery.freeFrom)}`}
          </p>
        )}
      </section>

      <PrinterSettingsCard businessName={s.business_name} />

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

        <form action={saveOnlineFee} className="mt-3 space-y-3 border-t border-cafe-100 pt-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="enabled" className="mt-1" defaultChecked={s.online_fee.enabled} />
            <span>
              <strong>Incluir la comisión en los precios al pagar con tarjeta a domicilio</strong>
              <span className="block text-cafe-600">
                Solo en pedidos a domicilio pagados con tarjeta en línea: los precios de los productos llevan la comisión de
                Stripe incluida (sin leyenda aparte), para que te llegue completo el importe. En efectivo, para recoger y en la
                caja se cobran tus precios normales.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Porcentaje (%)">
              <input name="percent" type="number" step="0.01" min="0" max="20" className="input" defaultValue={s.online_fee.percent} />
            </Field>
            <Field label="Cargo fijo ($)">
              <input name="fixed" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(s.online_fee.fixed)} />
            </Field>
            <Field label="IVA (%)">
              <input name="iva" type="number" step="1" min="0" max="30" className="input" defaultValue={s.online_fee.iva} />
            </Field>
          </div>
          <p className="text-xs text-cafe-600">
            Ejemplo con estas tarifas:{" "}
            {[10000, 20000, 50000]
              .map((a) => `${money(a)} → con tarjeta ${money(onlinePrice(a, { ...s.online_fee, enabled: true }))}`)
              .join(" · ")}
            . Revisa la tarifa vigente en tu cuenta de Stripe.
          </p>
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            ⚠️ En México, cobrar un cargo extra por pagar con tarjeta puede considerarse práctica indebida (Profeco) y algunos
            contratos de procesadores lo prohíben. Consúltalo con tu contador antes de activarlo. Alternativa: incluir el costo en
            el envío o en los precios.
          </p>
          <button className="btn-secondary">Guardar comisión</button>
        </form>
      </div>
    </div>
  );
}
