import Link from "next/link";
import StoreTabs from "@/components/StoreTabs";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Marco de la tienda para clientes: encabezado compacto + pestañas abajo. */
export default async function StoreLayout({ children }: LayoutProps<"/">) {
  const settings = await getSettings();
  return (
    <div className="flex flex-1 flex-col bg-cafe-50/40 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <header className="bg-cafe-900 text-cafe-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/" className="min-w-0">
            <span className="block truncate text-xl font-bold tracking-tight">
              {settings.business_name}
            </span>
            {settings.hours && (
              <span className="block truncate text-xs text-cafe-200">
                {settings.hours}
              </span>
            )}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              settings.store_open
                ? "bg-green-500/20 text-green-100"
                : "bg-red-600 text-white"
            }`}
          >
            {settings.store_open ? "● Recibiendo pedidos" : "Pedidos en pausa"}
          </span>
        </div>
      </header>
      {children}
      <StoreTabs rewards={settings.loyalty.enabled} />
    </div>
  );
}
