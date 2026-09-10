"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Supabase auth uid for observability identity cache keys.
 *
 * Not `useViewerUserId`: `["user","me"]` is not account-scoped, so a
 * same-tab magic-link swap can keep the previous Frapp user row after the
 * JWT has already changed.
 */
export function useAuthUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data.session?.user.id ?? null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return userId;
}
