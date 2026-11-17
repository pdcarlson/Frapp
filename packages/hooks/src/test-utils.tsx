/**
 * The provider wrapper the hook specs render under (#815). A `.tsx` file, so
 * package.json's `./*` export (`./src/*.ts`) never exposes it to the apps.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * A QueryClient that fails on the first error rather than retrying, so a spec
 * asserting an error state settles at once. Mutations already default to no
 * retry in TanStack Query v5; saying so here keeps a later default change out
 * of the specs.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * Wraps a hook in `FrappClientProvider` (outer) and `QueryClientProvider`
 * (inner), the order every spec builds by hand.
 *
 * `chapterId` defaults to `null`, as `FrappClientProvider` does. A
 * chapter-scoped hook gates its queries on the id and invalidates a key that
 * carries it, so a spec for one must pass the chapter it asserts against, or
 * its queries never run. `userId` defaults to `null` the same way; a spec for
 * a hook that scopes by the signed-in user passes one.
 */
export function createHookWrapper({
  client,
  queryClient = createTestQueryClient(),
  chapterId = null,
  userId = null,
  displayName = "HookTestWrapper",
}: {
  /** The stubbed API client: only the verbs the hook under test calls. */
  client: unknown;
  queryClient?: QueryClient;
  chapterId?: string | null;
  userId?: string | null;
  displayName?: string;
}) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={client as ReturnType<typeof createFrappClient>}
      chapterId={chapterId}
      userId={userId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = displayName;
  return Wrapper;
}
