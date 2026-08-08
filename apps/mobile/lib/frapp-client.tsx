import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { useEffect, useMemo, useRef } from "react";
import { readAuthToken } from "./auth-token";
import { useAuthSession } from "./auth-session";

export { AUTH_TOKEN_STORAGE_KEY } from "./auth-token";
export { useIsApiAuthenticated } from "./use-is-api-authenticated";

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
