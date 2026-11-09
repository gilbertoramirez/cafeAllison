import type { Metadata } from "next";
import { requireDriver } from "@/lib/drivers";
import { getSettings } from "@/lib/settings";
import { driverSignOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reparto · Café Allison", robots: { index: false } };

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const [driver, s] = await Promise.all([requireDriver(), getSettings()]);
  return (
    <div className="flex flex-1 flex-col bg-cafe-50">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-cafe-900 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate font-semibold">🛵 {s.business_name}</p>
          <p className="truncate text-xs text-cafe-200">{driver.name}</p>
        </div>
        <form action={driverSignOut}>
          <button className="rounded-full bg-white/15 px-3 py-1.5 text-sm">Salir</button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 p-4">{children}</main>
    </div>
  );
}
