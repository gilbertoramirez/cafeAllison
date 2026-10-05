import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite trae archivos .wasm/.data que se cargan en tiempo de ejecución
  serverExternalPackages: ["@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@electric-sql/pglite/dist/*.wasm", "./node_modules/@electric-sql/pglite/dist/*.data"],
  },
};

export default nextConfig;
