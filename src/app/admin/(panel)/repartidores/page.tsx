import { Field, PageTitle } from "@/components/admin/ui";
import { all } from "@/lib/db";
import { dateTime } from "@/lib/format";
import type { Driver } from "@/lib/drivers";
import { siteUrl } from "@/lib/url";
import { createDriver, deleteDriver, resetDriverPin, toggleDriver, updateDriver } from "../../actions";

export const dynamic = "force-dynamic";

const pinInput = (
  <input
    name="pin"
    className="input font-mono tracking-widest"
    inputMode="numeric"
    pattern="[0-9]{6}"
    maxLength={6}
    minLength={6}
    autoComplete="new-password"
    placeholder="6 números"
    required
  />
);

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const [drivers, base, stats] = await Promise.all([
    all<Driver>("SELECT id, name, phone, active, session_version, failed_attempts, locked_until, created_at FROM drivers ORDER BY active DESC, name"),
    siteUrl(),
    all<{ driver_id: number; n: number; last: string }>(
      "SELECT driver_id, COUNT(*) AS n, MAX(created_at) AS last FROM orders WHERE driver_id IS NOT NULL AND status = 'entregado' GROUP BY driver_id",
    ),
  ]);
  const now = new Date().toISOString();
  const byDriver = new Map(stats.map((r) => [r.driver_id, r]));
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle>Repartidores</PageTitle>
      <p className="-mt-3 text-sm text-cafe-600">
        Cada repartidor entra en <b>{base}/repartidor</b> con su teléfono y PIN. Solo ve los pedidos a domicilio (dirección,
        teléfono del cliente, qué lleva y cuánto cobrar) y puede marcarlos En camino o Entregado. No ve ventas, finanzas,
        inventario ni ajustes.
      </p>
      {ok && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">✓ {ok}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form action={createDriver} className="card grid gap-3 sm:grid-cols-[1fr_10rem_9rem_auto] sm:items-end">
        <h2 className="font-semibold sm:col-span-4">➕ Nuevo repartidor</h2>
        <Field label="Nombre">
          <input name="name" className="input" placeholder="Juan Pérez" required />
        </Field>
        <Field label="Teléfono (10 dígitos)">
          <input name="phone" className="input" type="tel" inputMode="tel" placeholder="3312345678" required />
        </Field>
        <Field label="PIN">{pinInput}</Field>
        <button className="btn-primary">Dar de alta</button>
      </form>

      {drivers.length === 0 ? (
        <p className="card text-sm text-cafe-600">Aún no hay repartidores.</p>
      ) : (
        <div className="space-y-3">
          {drivers.map((d) => {
            const st = byDriver.get(d.id);
            const locked = Boolean(d.locked_until && d.locked_until > now);
            return (
              <section key={d.id} className={`card space-y-3 ${d.active ? "" : "opacity-70"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    🧑‍✈️ {d.name}{" "}
                    <span className={`badge ${d.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>
                      {d.active ? "Activo" : "Desactivado"}
                    </span>
                    {locked && <span className="badge ml-1 bg-red-100 text-red-700">Bloqueado por intentos</span>}
                  </p>
                  <p className="text-xs text-cafe-600">
                    {st ? `${st.n} entrega${st.n === 1 ? "" : "s"} · última ${dateTime(st.last)}` : "Sin entregas"}
                  </p>
                </div>
                <form action={updateDriver} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                  <input type="hidden" name="id" value={d.id} />
                  <Field label="Nombre">
                    <input name="name" className="input" defaultValue={d.name} required />
                  </Field>
                  <Field label="Teléfono">
                    <input name="phone" className="input" type="tel" defaultValue={d.phone} required />
                  </Field>
                  <button className="btn-secondary">Guardar</button>
                </form>
                <form action={resetDriverPin} className="grid gap-2 sm:grid-cols-[10rem_auto] sm:items-end">
                  <input type="hidden" name="id" value={d.id} />
                  <Field label="Nuevo PIN">{pinInput}</Field>
                  <button className="btn-secondary">Cambiar PIN</button>
                </form>
                <div className="flex flex-wrap gap-4 border-t border-cafe-100 pt-3 text-sm">
                  <form action={toggleDriver.bind(null, d.id)}>
                    <button className="underline">{d.active ? "🚫 Desactivar (ya no puede entrar)" : "✅ Activar"}</button>
                  </form>
                  <form action={deleteDriver.bind(null, d.id)}>
                    <button className="text-red-700 underline">Eliminar</button>
                  </form>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
