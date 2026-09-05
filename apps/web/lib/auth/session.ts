"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export async function getSessionUser() {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function signOutCurrentSession() {
  const supabase = createSupabaseBrowserClient();
  await supabase.auth.signOut();
}
