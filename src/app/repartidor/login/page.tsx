import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentDriver } from "@/lib/drivers";
import { getSettings } from "@/lib/settings";
import DriverLoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Repartidores · Café Allison", robots: { index: false } };

export default async function DriverLoginPage() {
  if (await currentDriver()) redirect("/repartidor");
  const s = await getSettings();
  return (
    <main className="flex flex-1 items-center justify-center bg-cafe-50 p-4">
      <div className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <p className="text-4xl">🛵</p>
          <h1 className="text-xl font-bold">{s.business_name}</h1>
          <p className="text-sm text-cafe-600">Acceso para repartidores</p>
        </div>
        <DriverLoginForm />
        <p className="text-center text-xs text-cafe-500">¿Olvidaste tu PIN? Pídele al administrador que te asigne uno nuevo.</p>
      </div>
    </main>
  );
}
