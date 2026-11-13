import Link from "next/link";
import StoreTabs from "@/components/StoreTabs";
import { getSettings } from "@/lib/settings";
import { hoursText, isOpenNow, nextOpening } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** Marco de la tienda para clientes: encabezado compacto + pestañas abajo. */
export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const settings = await getSettings();
  const openNow = !settings.schedule.enabled || isOpenNow(settings.schedule);
  const hours = settings.schedule.enabled ? hoursText(settings.schedule) : settings.hours;
  const opensAt = openNow ? null : nextOpening(settings.schedule);
  return (
    <div className="flex flex-1 flex-col bg-cafe-50/40 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <header className="bg-cafe-900 text-cafe-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="min-w-0">
            <span className="block truncate text-xl font-bold tracking-tight">
              {settings.business_name}
            </span>
            {hours && (
              <span className="block truncate text-xs text-cafe-200">
                {hours}
              </span>
            )}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              !settings.store_open ? "bg-red-600 text-white" : openNow ? "bg-green-500/20 text-green-100" : "bg-amber-500/25 text-amber-100"
            }`}
          >
            {!settings.store_open ? "Pedidos en pausa" : openNow ? "● Abierto" : opensAt ? `Cerrado · abrimos ${opensAt}` : "Cerrado"}
          </span>
        </div>
      </header>
      {children}
      <StoreTabs rewards={settings.loyalty.enabled} />
    </div>
  );
}
