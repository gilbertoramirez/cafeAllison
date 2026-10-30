import type { Metadata } from "next";
import { MyOrdersView } from "@/components/MyOrders";

export const metadata: Metadata = { title: "Mis pedidos · Café Allison" };

export default function OrdersPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">
      <h1 className="mb-4 text-2xl font-bold">Mis pedidos</h1>
      <MyOrdersView />
    </main>
  );
}
