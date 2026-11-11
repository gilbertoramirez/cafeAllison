import Link from "next/link";
import { all } from "@/lib/db";
import { currentSession } from "@/lib/cash";
import { productLabel, type Product } from "@/lib/types";
import PosTerminal from "@/components/admin/PosTerminal";

export default async function PosPage() {
  const [products, cash] = await Promise.all([
    all<Product>(
      "SELECT * FROM products WHERE active = 1 ORDER BY (SELECT MIN(p2.sort) FROM products p2 WHERE p2.category = products.category), category, sort, name",
    ),
    currentSession(),
  ]);
  return (
    <>
      {!cash && (
        <Link
          href="/admin/caja"
          className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200"
        >
          <span>🔒 La caja no está abierta. Ábrela con tu fondo para poder hacer el corte al final del día.</span>
          <span className="shrink-0 font-semibold underline">Abrir caja ›</span>
        </Link>
      )}
      <PosTerminal
        products={products.map((p) => ({
          id: p.id,
          name: productLabel(p),
          icon: p.icon,
          category: p.category,
          size: p.size,
          price: p.price,
          maxQty: p.track_stock ? Math.max(p.stock, 0) : 999,
        }))}
      />
    </>
  );
}
