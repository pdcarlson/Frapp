import React, { useMemo } from "react";
import { useAuth } from "@clerk/clerk-expo";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001/v1";

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  const client = useMemo(() => {
    return createFrappClient({
      baseUrl: API_URL,
      getAuthToken: async () => {
        return await getToken();
      },
      getChapterId: () => {
        // Handle chapter ID for mobile
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
