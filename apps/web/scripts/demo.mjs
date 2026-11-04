// `pnpm demo`: run the web app in demo mode (no Supabase needed). Works on Windows, macOS and Linux.
import { spawn } from "node:child_process";

const child = spawn("next dev", {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_DEMO_MODE: "1", NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
