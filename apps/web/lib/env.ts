// process.env.NEXT_PUBLIC_* must be referenced literally so Next can inline it into the browser bundle.

/**
 * Demo mode (`pnpm demo`): no Supabase account needed. Login uses a fixed OTP and
 * data lives in a local Postgres on this computer. Development only.
 */
export const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. Copy apps/web/.env.example to apps/web/.env.local.`);
  return value;
}

export function supabaseConfig(): { url: string; key: string } {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    key: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  };
}
