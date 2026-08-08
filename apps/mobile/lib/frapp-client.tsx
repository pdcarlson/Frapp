import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { readAuthToken, subscribeToAuthToken } from "./auth-token";
import { useAuthSession } from "./auth-session";

export { AUTH_TOKEN_STORAGE_KEY } from "./auth-token";

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

export function FrappProvider({ children }: { children: React.ReactNode }) {
  const { chapterId } = useAuthSession();

  // The SDK's `getChapterId` is synchronous and baked into the client's
  // middleware, so it reads through a ref. Rebuilding the client on every
  // chapter change (as web does) would drop in-flight requests for no gain —
  // the middleware already runs per request.
  const chapterIdRef = useRef(chapterId);
  useEffect(() => {
    chapterIdRef.current = chapterId;
  }, [chapterId]);

  const client = useMemo(
    () =>
      createFrappClient({
        baseUrl:
          process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001/v1",
        getAuthToken: readAuthToken,
        getChapterId: () => chapterIdRef.current,
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <FrappClientProvider client={client} chapterId={chapterId}>
        {children}
      </FrappClientProvider>
    </QueryClientProvider>
  );
}

export function useIsApiAuthenticated() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const refresh = async () => {
      try {
        const token = await readAuthToken();
        if (isMounted) setIsAuthenticated(!!token);
      } catch {
        if (isMounted) setIsAuthenticated(false);
      }
    };

    void refresh();

    // Sign-in and token refresh both happen while the app is open, so the
    // AppState listener alone would leave this stale until the next
    // background/foreground cycle.
    const unsubscribe = subscribeToAuthToken(() => {
      void refresh();
    });

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });

    return () => {
      isMounted = false;
      unsubscribe();
      subscription.remove();
    };
  }, []);

  return isAuthenticated;
}
