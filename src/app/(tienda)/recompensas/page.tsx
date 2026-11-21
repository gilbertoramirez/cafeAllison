import type { Metadata } from "next";
import Link from "next/link";
import { RewardsView } from "@/components/MyOrders";
import { getSettings } from "@/lib/settings";

// ISR: la CDN sirve esta página ya generada. Se regenera como máximo cada 60 s
// y al instante cuando el panel guarda un cambio (revalidatePath en las acciones).
export const revalidate = 60;
export const metadata: Metadata = { title: "Recompensas · Café Allison" };

export default async function RewardsPage() {
  const { loyalty } = await getSettings();
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">
      <h1 className="mb-4 text-2xl font-bold">Recompensas</h1>
      {loyalty.enabled ? (
        <RewardsView rules={loyalty} />
      ) : (
        <p className="rounded-2xl bg-white p-5 text-sm text-cafe-600 shadow-sm">
          Por ahora no hay programa de recompensas.{" "}
          <Link href="/" className="underline">
            Ver el menú
          </Link>
        </p>
      )}
    </main>
  );
}
