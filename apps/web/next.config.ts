import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "xlsx"],
  transpilePackages: ["@winata/engine", "@winata/db", "@winata/parsers"],
  eslint: { ignoreDuringBuilds: true },
  typedRoutes: false,
};

export default nextConfig;
