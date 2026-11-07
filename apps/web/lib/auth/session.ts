"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { resetObservabilityOnLogout } from "@/lib/observability/reset";

export async function getSessionUser() {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function signOutCurrentSession(
  options: { scope?: "global" | "local" } = {},
) {
  const supabase = createSupabaseBrowserClient();
  await supabase.auth.signOut(options.scope ? { scope: options.scope } : undefined);
  resetObservabilityOnLogout();
}
