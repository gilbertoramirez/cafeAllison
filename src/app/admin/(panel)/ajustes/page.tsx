import { Field, PageTitle } from "@/components/admin/ui";
import { centsToInput, money } from "@/lib/format";
import { getDeliveryRules, getSettings, stripeEnabled } from "@/lib/settings";
import { feeForDistance } from "@/lib/delivery";
import CafeLocationInput from "@/components/admin/CafeLocationInput";
import { onlinePrice } from "@/lib/fees";
import { randomBytes } from "node:crypto";
import {
  saveDeliverySettings,
  saveLoyaltySettings,
  saveNtfySettings,
  saveOnlineFee,
  saveSettings,
} from "../../actions";
import NtfyTestButton from "@/components/admin/NtfyTestButton";
import { smsEnabled } from "@/lib/sms";
import PrinterSettingsCard from "@/components/admin/PrinterSettingsCard";

export default async function SettingsPage() {
  const [s, delivery] = await Promise.all([getSettings(), getDeliveryRules()]);
  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle>Ajustes</PageTitle>
      <form action={saveSettings} className="card grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del negocio" className="sm:col-span-2">
          <input
            name="business_name"
            className="input"
            defaultValue={s.business_name}
            required
          />
        </Field>
        <Field
          label="WhatsApp del negocio"
          hint="10 dígitos, ej. 5512345678. Los pedidos por WhatsApp llegan aquí."
        >
          <input
            name="whatsapp_number"
            className="input"
            defaultValue={s.whatsapp_number}
            inputMode="tel"
          />
        </Field>
        <Field label="Horario">
          <input name="hours" className="input" defaultValue={s.hours} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <input name="address" className="input" defaultValue={s.address} />
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
          <input
            type="checkbox"
            name="store_open"
            defaultChecked={s.store_open}
          />{" "}
          Recibir pedidos en línea
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="delivery_enabled"
            defaultChecked={s.delivery_enabled}
          />{" "}
          Ofrecer entrega a domicilio
        </label>
        <div className="sm:col-span-2">
          <button className="btn-primary">Guardar ajustes</button>
        </div>
      </form>

      <form action={saveDeliverySettings} className="card space-y-3 text-sm">
        <h2 className="font-semibold">🛵 Envío a domicilio por distancia</h2>
        <p className="text-cafe-600">
          Medimos con Google Maps los km por calle desde la cafetería hasta la dirección del cliente.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Envío base ($)">
            <input name="delivery_fee" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(s.delivery_fee)} />
          </Field>
          <Field label="Incluye hasta (km)">
            <input name="base_km" type="number" step="0.1" min="0" className="input" defaultValue={s.delivery_base_km} />
          </Field>
          <Field label="Por cada km extra ($)">
            <input name="per_km" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(s.delivery_per_km)} />
          </Field>
          <Field label="Distancia máxima (km)" hint="0 = sin límite">
            <input name="max_km" type="number" step="0.1" min="0" className="input" defaultValue={s.delivery_max_km} />
          </Field>
          <Field label="Envío gratis desde ($)" hint="0 = nunca gratis">
            <input name="free_delivery_from" type="number" step="0.01" min="0" className="input" defaultValue={centsToInput(s.free_delivery_from)} />
          </Field>
        </div>
        <p className="rounded-lg bg-cafe-50 p-2 text-cafe-700">
          Ejemplos: {[1.5, 4.2, 6.8].map((km) => {
            const q = feeForDistance(delivery, km, 0);
            return `${km} km → ${q.ok ? money(q.fee) : "no se entrega"}`;
          }).join(" · ")}
          <span className="block text-xs">El km extra se cobra completo aunque sea una fracción.</span>
        </p>
        <Field label="Ubicación exacta de la cafetería (de aquí salen los envíos)">
          <CafeLocationInput defaultValue={s.cafe_location ? `${s.cafe_location.lat}, ${s.cafe_location.lng}` : ""} />
        </Field>
        <p className="text-cafe-600">
          {s.cafe_location ? (
            <>
              ✓ Ubicación guardada.{" "}
              <a
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${s.cafe_location.lat},${s.cafe_location.lng}`}
              >
                Verla en el mapa
              </a>
            </>
          ) : (
            "Si la dejas vacía se usa la dirección del negocio (arriba). Para más precisión toca “Estoy en la cafetería” estando en el local, o copia los números de Google Maps (mantén presionado sobre tu local)."
          )}
        </p>
        <p className={delivery.maps ? "text-green-700" : "text-amber-700"}>
          {delivery.maps
            ? "✓ Google Maps está configurado."
            : "Google Maps no está configurado: mientras tanto se cobra solo el envío base a cualquier dirección. Agrega GOOGLE_MAPS_API_KEY en Vercel."}
        </p>
        <button className="btn-primary">Guardar envío</button>
      </form>

      <form action={saveLoyaltySettings} className="card space-y-3 text-sm">
        <h2 className="font-semibold">☕ Programa de lealtad</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={s.loyalty.enabled}
          />{" "}
          Activar tarjeta de sellos
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Sellos para premio">
            <input
              name="needed"
              type="number"
              min="1"
              max="50"
              className="input"
              defaultValue={s.loyalty.needed}
            />
          </Field>
          <Field label="Compra mínima ($)">
            <input
              name="min"
              type="number"
              step="0.01"
              min="0"
              className="input"
              defaultValue={centsToInput(s.loyalty.minPurchase)}
            />
          </Field>
          <Field label="Sellos duran (meses)">
            <input
              name="months"
              type="number"
              min="1"
              max="24"
              className="input"
              defaultValue={s.loyalty.stampMonths}
            />
          </Field>
          <Field label="Bebida gratis dura (días)">
            <input
              name="days"
              type="number"
              min="1"
              max="365"
              className="input"
              defaultValue={s.loyalty.rewardDays}
            />
          </Field>
        </div>
        <p className="text-cafe-600">
          1 sello por día por teléfono, en compras pagadas desde la compra
          mínima (en línea con el teléfono del pedido; en la caja escribiendo el
          teléfono del cliente). Premio: una bebida de hasta 12oz. Cancelar una
          venta quita su sello.
        </p>
        <p className={smsEnabled() ? "text-green-700" : "text-amber-700"}>
          {smsEnabled()
            ? "✓ Canje en línea activo: el cliente recibe un código por mensaje."
            : "Canje en línea desactivado: configura Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM). Mientras tanto se canjea en la caja."}
        </p>
        <button className="btn-secondary">Guardar lealtad</button>
      </form>

      <form action={saveNtfySettings} className="card space-y-3 text-sm">
        <h2 className="font-semibold">🔔 Avisos al celular (ntfy)</h2>
        <ol className="list-decimal space-y-1 pl-5 text-cafe-700">
          <li>
            Instala la app gratuita <b>ntfy</b> en tu celular (Play Store o App
            Store).
          </li>
          <li>
            Toca <b>+</b>, escribe exactamente el mismo nombre de tema que
            aparece abajo y suscríbete.
          </li>
          <li>Toca “Enviar prueba”.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre del tema">
            <input
              name="topic"
              className="input font-mono"
              pattern="[A-Za-z0-9_\-]{1,64}"
              defaultValue={
                s.ntfy.topic || `cafe-allison-${randomBytes(5).toString("hex")}`
              }
              required
            />
          </Field>
          <Field label="Servidor">
            <input
              name="server"
              className="input"
              placeholder="https://ntfy.sh"
              defaultValue={
                s.ntfy.server === "https://ntfy.sh" ? "" : s.ntfy.server
              }
            />
          </Field>
        </div>
        <p className="text-amber-700">
          Cualquiera que conozca el nombre del tema puede leer los avisos: usa
          uno difícil de adivinar y no lo compartas. Los avisos no incluyen
          teléfonos ni direcciones.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="new"
              defaultChecked={s.ntfy.newOrders}
            />{" "}
            Pedidos nuevos
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="updates"
              defaultChecked={s.ntfy.updates}
            />{" "}
            Cambios (estado, pago, cancelación)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="pos" defaultChecked={s.ntfy.pos} />{" "}
            También ventas de caja
          </label>
        </div>
        <p className={s.ntfy.topic ? "text-green-700" : "text-cafe-600"}>
          {s.ntfy.topic
            ? `✓ Avisos activos en el tema “${s.ntfy.topic}”.`
            : "Avisos apagados hasta que guardes un tema."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary">Guardar avisos</button>
          {s.ntfy.topic && (
            <a
              href={`ntfy://${s.ntfy.server.replace(/^https?:\/\//, "")}/${s.ntfy.topic}`}
              className="btn-secondary"
            >
              📲 Suscribirme en la app ntfy
            </a>
          )}
          {s.ntfy.topic && <NtfyTestButton />}
        </div>
      </form>

      <PrinterSettingsCard businessName={s.business_name} />

      <div className="card space-y-1 text-sm">
        <h2 className="font-semibold">Pagos en línea (Stripe)</h2>
        {stripeEnabled() ? (
          <p className="text-green-700">
            ✓ Stripe está configurado. Tus clientes pueden pagar con tarjeta.
          </p>
        ) : (
          <p className="text-cafe-700">
            No configurado. Agrega <code>STRIPE_SECRET_KEY</code> y{" "}
            <code>STRIPE_WEBHOOK_SECRET</code> en las variables de entorno (ver
            README). Mientras tanto los clientes pueden pagar en efectivo o por
            WhatsApp.
          </p>
        )}

        <form
          action={saveOnlineFee}
          className="mt-3 space-y-3 border-t border-cafe-100 pt-3"
        >
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="enabled"
              className="mt-1"
              defaultChecked={s.online_fee.enabled}
            />
            <span>
              <strong>
                Incluir la comisión de Stripe en los precios de la tienda en
                línea
              </strong>
              <span className="block text-cafe-600">
                Todo el menú de la tienda en línea se muestra y cobra con la
                comisión incluida (redondeado al peso), sin leyenda aparte. Al
                pagar con tarjeta se cubre además el cargo fijo por cobro (en el
                envío o en un producto). La caja del panel usa siempre tus
                precios normales.
              </span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Porcentaje (%)">
              <input
                name="percent"
                type="number"
                step="0.01"
                min="0"
                max="20"
                className="input"
                defaultValue={s.online_fee.percent}
              />
            </Field>
            <Field label="Cargo fijo ($)">
              <input
                name="fixed"
                type="number"
                step="0.01"
                min="0"
                className="input"
                defaultValue={centsToInput(s.online_fee.fixed)}
              />
            </Field>
            <Field label="IVA (%)">
              <input
                name="iva"
                type="number"
                step="1"
                min="0"
                max="30"
                className="input"
                defaultValue={s.online_fee.iva}
              />
            </Field>
          </div>
          <p className="text-xs text-cafe-600">
            Ejemplo con estas tarifas:{" "}
            {[10000, 20000, 50000]
              .map(
                (a) =>
                  `${money(a)} → tienda en línea ${money(onlinePrice(a, { ...s.online_fee, enabled: true }))}`,
              )
              .join(" · ")}
            . Revisa la tarifa vigente en tu cuenta de Stripe.
          </p>
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            ⚠️ En México, cobrar un cargo extra por pagar con tarjeta puede
            considerarse práctica indebida (Profeco) y algunos contratos de
            procesadores lo prohíben. Consúltalo con tu contador antes de
            activarlo. Alternativa: incluir el costo en el envío o en los
            precios.
          </p>
          <button className="btn-secondary">Guardar comisión</button>
        </form>
      </div>
    </div>
  );
}
