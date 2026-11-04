import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@rentflow/core", "@rentflow/db", "@rentflow/server", "@rentflow/ui"],
  // Native/WASM or browser-launching packages are loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "puppeteer-core", "pg-boss", "exceljs", "postgres"],
  experimental: {
    // Meter photos and screenshots are uploaded through server actions.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default withNextIntl(nextConfig);
