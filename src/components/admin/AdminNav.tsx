"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Resumen", icon: "📊" },
  { href: "/admin/pos", label: "Punto de venta", icon: "🧾" },
  { href: "/admin/pedidos", label: "Pedidos", icon: "🛵" },
  { href: "/admin/productos", label: "Menú", icon: "☕" },
  { href: "/admin/inventario", label: "Inventario", icon: "📦" },
  { href: "/admin/gastos", label: "Gastos", icon: "💸" },
  { href: "/admin/finanzas", label: "Finanzas", icon: "📈" },
  { href: "/admin/ajustes", label: "Ajustes", icon: "⚙️" },
];

export default function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              active ? "bg-cafe-700 text-white" : "text-cafe-200 hover:bg-cafe-800"
            }`}
          >
            <span>{l.icon}</span>
            {l.label}
          </Link>
        );
      })}
      <Link href="/" className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-cafe-300 hover:bg-cafe-800">
        <span>🌐</span>Ver tienda
      </Link>
    </nav>
  );
}
