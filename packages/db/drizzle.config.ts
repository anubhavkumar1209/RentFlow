import { defineConfig } from "drizzle-kit";

// DATABASE_URL (from packages/db/.env) is only needed for `migrate`; `generate` works offline.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fine for `generate` and in CI.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
