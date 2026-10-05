import { all } from "@/lib/db";
import { productLabel, type Product } from "@/lib/types";
import PosTerminal from "@/components/admin/PosTerminal";

export default async function PosPage() {
  const products = await all<Product>("SELECT * FROM products WHERE active = 1 ORDER BY (SELECT MIN(p2.sort) FROM products p2 WHERE p2.category = products.category), category, sort, name");
  return (
    <PosTerminal
      products={products.map((p) => ({
        id: p.id,
        name: productLabel(p),
        category: p.category,
        price: p.price,
        maxQty: p.track_stock ? Math.max(p.stock, 0) : 999,
      }))}
    />
  );
}
