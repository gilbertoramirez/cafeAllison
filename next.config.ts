import type { NextConfig } from "next";

// Nunca en caché pública: datos de clientes, sesiones, pagos y mutaciones
const PRIVATE = [{ key: "Cache-Control", value: "private, no-store, max-age=0" }];

const nextConfig: NextConfig = {
  // Páginas ISR: la CDN puede dar una copia vieja como máximo 5 min mientras regenera en segundo plano
  // (s-maxage=60, stale-while-revalidate=240). Así el letrero Abierto/Cerrado no queda horas atrasado.
  expireTime: 300,
  async headers() {
    return [
      // Toda la API excepto /api/foto (fotos públicas con nombre único, ya llevan caché de 1 año)
      { source: "/api/:path((?!foto$).*)", headers: PRIVATE },
      { source: "/admin/:path*", headers: PRIVATE },
      { source: "/admin", headers: PRIVATE },
      { source: "/repartidor/:path*", headers: PRIVATE },
      { source: "/repartidor", headers: PRIVATE },
      { source: "/pedido/:token", headers: PRIVATE },
    ];
  },
  // PGlite trae archivos .wasm/.data que se cargan en tiempo de ejecución
  serverExternalPackages: ["@electric-sql/pglite", "exceljs"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@electric-sql/pglite/dist/*.wasm", "./node_modules/@electric-sql/pglite/dist/*.data"],
  },
};

export default nextConfig;
