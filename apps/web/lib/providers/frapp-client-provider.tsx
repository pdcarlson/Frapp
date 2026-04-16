"use client";

import React, { useMemo } from "react";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useChapterStore } from "@/lib/stores/chapter-store";

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);

  const client = useMemo(
    () =>
      createFrappClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/v1",
        getAuthToken: async () => {
          const supabase = createSupabaseBrowserClient();
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? null;
        },
        getChapterId: () => activeChapterId,
      }),
    [activeChapterId],
  );

  return (
    <FrappClientProvider client={client} chapterId={activeChapterId}>
      {children}
    </FrappClientProvider>
  );
}
