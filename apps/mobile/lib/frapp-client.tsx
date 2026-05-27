import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";

export const AUTH_TOKEN_STORAGE_KEY = "frapp.mobile.auth-token";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 60_000,
    },
    mutations: {
      retry: 0,
    },
  },
});

async function readAuthToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () =>
      createFrappClient({
        baseUrl:
          process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001/v1",
        getAuthToken: readAuthToken,
        getChapterId: () => null,
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <FrappClientProvider client={client} chapterId={null}>
        {children}
      </FrappClientProvider>
    </QueryClientProvider>
  );
}

export function useIsApiAuthenticated() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;
    readAuthToken()
      .then((token) => {
        if (isMounted) {
          setIsAuthenticated(!!token);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  return isAuthenticated;
}
