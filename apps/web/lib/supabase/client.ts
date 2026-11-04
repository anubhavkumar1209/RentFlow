import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "../env";

export function createClient() {
  const { url, key } = supabaseConfig();
  return createBrowserClient(url, key);
}
