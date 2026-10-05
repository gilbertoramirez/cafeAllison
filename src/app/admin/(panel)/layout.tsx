import { requireAdmin } from "@/lib/auth";
import { get, isEphemeralDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { logout } from "../actions";
import AdminNav, { MobileTabBar } from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const [settings, active] = await Promise.all([
    getSettings(),
    get<{ n: number }>("SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('entregado','cancelado') AND channel <> 'mostrador'"),
  ]);
  const activeOrders = active?.n ?? 0;
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      {/* Escritorio: barra lateral */}
      <aside className="hidden bg-cafe-900 text-cafe-100 md:block md:w-56 md:shrink-0">
        <div className="p-4">
          <p className="font-semibold text-white">{settings.business_name}</p>
          <p className="text-xs text-cafe-300">Panel de administración</p>
          <form action={logout} className="mt-3">
            <button className="text-xs text-cafe-300 underline">Cerrar sesión</button>
          </form>
        </div>
        <AdminNav activeOrders={activeOrders} />
      </aside>

      {/* Celular: encabezado compacto */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-cafe-900 px-4 py-2.5 text-white md:hidden">
        <p className="font-semibold">{settings.business_name}</p>
        <span className="text-xs text-cafe-300">Administración</span>
      </header>

      <main className="min-w-0 flex-1 p-4 pb-24 md:p-6 md:pb-6">
        {isEphemeralDb && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            ⚠️ Modo demo: la base de datos es temporal y los datos se pueden borrar en cualquier momento. Conecta Neon
            (variable <code>DATABASE_URL</code>) antes de usarlo con ventas reales.
          </p>
        )}
        {children}
      </main>

      <MobileTabBar activeOrders={activeOrders} logout={logout} />
    </div>
  );
}
