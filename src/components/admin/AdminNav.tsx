"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/admin", label: "Resumen", short: "Resumen", icon: "📊" },
  { href: "/admin/pos", label: "Punto de venta", short: "Caja", icon: "🧾" },
  { href: "/admin/pedidos", label: "Pedidos", short: "Pedidos", icon: "🛵" },
  { href: "/admin/productos", label: "Menú", short: "Menú", icon: "☕" },
  { href: "/admin/inventario", label: "Inventario", short: "Inventario", icon: "📦" },
  { href: "/admin/gastos", label: "Gastos", short: "Gastos", icon: "💸" },
  { href: "/admin/finanzas", label: "Finanzas", short: "Finanzas", icon: "📈" },
  { href: "/admin/ajustes", label: "Ajustes", short: "Ajustes", icon: "⚙️" },
];
const PRIMARY = 4; // en celular: los primeros 4 van en la barra inferior, el resto en "Más"

function isActive(path: string, href: string) {
  return href === "/admin" ? path === "/admin" : path.startsWith(href);
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -top-1 right-1/2 translate-x-4 rounded-full bg-red-600 px-1.5 text-[10px] leading-4 font-bold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Barra lateral (escritorio). */
export default function AdminNav({ activeOrders = 0 }: { activeOrders?: number }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-2 pb-4">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            isActive(path, l.href) ? "bg-cafe-700 text-white" : "text-cafe-200 hover:bg-cafe-800"
          }`}
        >
          <span>{l.icon}</span>
          <span className="flex-1">{l.label}</span>
          {l.href === "/admin/pedidos" && activeOrders > 0 && (
            <span className="rounded-full bg-red-600 px-2 text-xs font-bold text-white">{activeOrders}</span>
          )}
        </Link>
      ))}
      <Link href="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-cafe-300 hover:bg-cafe-800">
        <span>🌐</span>Ver tienda
      </Link>
    </nav>
  );
}

/** Barra inferior tipo app (celular). */
export function MobileTabBar({ activeOrders = 0, logout }: { activeOrders?: number; logout: () => Promise<void> }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const extra = LINKS.slice(PRIMARY);
  const extraActive = extra.some((l) => isActive(path, l.href));

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMore(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[calc(5rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-cafe-200" />
            <div className="grid grid-cols-3 gap-2">
              {extra.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMore(false)}
                  className={`flex flex-col items-center gap-1 rounded-xl p-3 text-sm ${
                    isActive(path, l.href) ? "bg-cafe-800 text-white" : "bg-cafe-50 text-cafe-900"
                  }`}
                >
                  <span className="text-2xl">{l.icon}</span>
                  {l.short}
                </Link>
              ))}
              <Link href="/" onClick={() => setMore(false)} className="flex flex-col items-center gap-1 rounded-xl bg-cafe-50 p-3 text-sm">
                <span className="text-2xl">🌐</span>Tienda
              </Link>
              <form action={logout} className="contents">
                <button className="flex flex-col items-center gap-1 rounded-xl bg-cafe-50 p-3 text-sm text-red-700">
                  <span className="text-2xl">🚪</span>Salir
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-cafe-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-5">
          {LINKS.slice(0, PRIMARY).map((l) => {
            const active = isActive(path, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMore(false)}
                className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  active ? "text-cafe-900" : "text-cafe-500"
                }`}
              >
                <span className={`rounded-full px-3 py-0.5 text-lg ${active ? "bg-cafe-100" : ""}`}>{l.icon}</span>
                {l.short}
                {l.href === "/admin/pedidos" && <Badge n={activeOrders} />}
              </Link>
            );
          })}
          <button
            onClick={() => setMore((v) => !v)}
            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              more || extraActive ? "text-cafe-900" : "text-cafe-500"
            }`}
          >
            <span className={`rounded-full px-3 py-0.5 text-lg ${more || extraActive ? "bg-cafe-100" : ""}`}>☰</span>
            Más
          </button>
        </div>
      </nav>
    </>
  );
}
