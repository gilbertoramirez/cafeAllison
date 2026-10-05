import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { logout } from "../actions";
import AdminNav from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const settings = await getSettings();
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="bg-cafe-900 text-cafe-100 md:w-56 md:shrink-0">
        <div className="flex items-center justify-between p-4 md:block">
          <div>
            <p className="font-semibold text-white">{settings.business_name}</p>
            <p className="text-xs text-cafe-300">Panel de administración</p>
          </div>
          <form action={logout} className="md:mt-3">
            <button className="text-xs text-cafe-300 underline">Cerrar sesión</button>
          </form>
        </div>
        <AdminNav />
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
