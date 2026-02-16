"use client";

import { useAuth } from "@clerk/nextjs";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { useMemo } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/v1";

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  const client = useMemo(() => {
    return createFrappClient({
      baseUrl: API_URL,
      getAuthToken: async () => {
        return await getToken();
      },
      getChapterId: () => {
        if (typeof window !== "undefined") {
          return localStorage.getItem("frapp_chapter_id");
        }
        return null;
      },
    });
  }, [getToken]);

  return (
    <FrappClientProvider client={client}>
      {children}
    </FrappClientProvider>
  );
}
