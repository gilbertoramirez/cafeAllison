"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMyOrders } from "./MyOrders";

type Tab = {
  href: string;
  label: string;
  icon: string;
  match: (path: string) => boolean;
};

/** Barra de pestañas de la tienda (abajo, como en las apps de café). */
export default function StoreTabs({ rewards }: { rewards: boolean }) {
  const path = usePathname();
  const { active } = useMyOrders();
  const tabs: Tab[] = [
    { href: "/", label: "Menú", icon: "☕", match: (p) => p === "/" },
    {
      href: "/pedidos",
      label: "Pedidos",
      icon: "🧾",
      match: (p) => p.startsWith("/pedido"),
    },
    ...(rewards
      ? [
          {
            href: "/recompensas",
            label: "Recompensas",
            icon: "🎁",
            match: (p: string) => p === "/recompensas",
          },
        ]
      : []),
    {
      href: "/cafe",
      label: "El café",
      icon: "📍",
      match: (p) => p === "/cafe",
    },
  ];
  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-cafe-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex h-16 max-w-md">
        {tabs.map((t) => {
          const on = t.match(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                on ? "text-cafe-900" : "text-cafe-500"
              }`}
            >
              <span
                className={`text-xl transition ${on ? "scale-110" : "opacity-70 grayscale"}`}
              >
                {t.icon}
              </span>
              {t.label}
              {on && (
                <span className="absolute top-0 h-0.5 w-10 rounded-full bg-cafe-800" />
              )}
              {t.href === "/pedidos" && active.length > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] text-white">
                  {active.length}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
