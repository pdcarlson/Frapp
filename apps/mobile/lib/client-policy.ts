import { useEffect } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";

/**
 * Is this build still supported? (#2526)
 *
 * Asks `GET /v1/client-policy`, which compares the `X-Client-Version` header
 * every request carries (`lib/client-version.ts`) with the deployment's
 * minimum. It runs at launch and again whenever the app returns to the
 * foreground with an answer older than {@link CLIENT_POLICY_STALE_MS}:
 * `lib/connection/query-connectivity.ts` drives TanStack's focus manager from
 * `AppState`.
 *
 * **It fails open.** Only a 2xx whose body says `update_required: true`
 * blocks. A network error, any non-2xx (an empty-bodied 5xx from the CDN
 * included), a timeout or a body in any other shape is not an answer, so it
 * never blocks, and it never lifts a block an earlier answer set either:
 * TanStack keeps the last successful data through a failed refetch. A later
 * answer of `update_required: false` lifts it.
 *
 * **It has its own `QueryClient`.** The product cache is wiped wholesale on
 * sign-out, on an account swap and on a chapter switch
 * (`clearProductQueryCache`, `FrappProvider`), and an auth-js `SIGNED_OUT`
 * reaches the first of those with no tap at all. A block stored there would
 * be erased by any of them, and the gate would lift until a refetch
 * succeeded.
 */

export const CLIENT_POLICY_QUERY_KEY = ["client-policy"] as const;

/** How old an answer may be before a return to the foreground asks again. */
export const CLIENT_POLICY_STALE_MS = 60_000;

export const clientPolicyQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst",
      retry: 1,
      staleTime: CLIENT_POLICY_STALE_MS,
    },
  },
});

export interface ClientPolicy {
  updateRequired: boolean;
  /** The https link the update screen opens, or null when there is none to trust. */
  updateUrl: string | null;
}

const SUPPORTED: ClientPolicy = { updateRequired: false, updateUrl: null };

/**
 * The response body, read strictly, or null when it isn't an answer. This
 * binary can't be fixed after it ships, so it trusts nothing it wasn't told
 * exactly: `update_required` must be a boolean, and a link that isn't https is
 * dropped rather than handed to the OS.
 */
export function readClientPolicy(data: unknown): ClientPolicy | null {
  if (typeof data !== "object" || data === null) return null;
  const { update_required: updateRequired, update_url: updateUrl } =
    data as Record<string, unknown>;
  if (typeof updateRequired !== "boolean") return null;
  if (!updateRequired) return SUPPORTED;
  return {
    updateRequired: true,
    updateUrl:
      typeof updateUrl === "string" && /^https:\/\//i.test(updateUrl)
        ? updateUrl
        : null,
  };
}

export function useClientPolicy(
  queryClient: QueryClient = clientPolicyQueryClient,
): ClientPolicy {
  const client = useFrappClient();

  // A QueryClientProvider would mount it, but one here would also hand this
  // client to the whole app underneath the gate. Mounting is what subscribes
  // it to the focus and online managers, which drive the foreground recheck.
  useEffect(() => {
    queryClient.mount();
    return () => queryClient.unmount();
  }, [queryClient]);

  const { data } = useQuery(
    {
      queryKey: CLIENT_POLICY_QUERY_KEY,
      queryFn: async () => {
        const { data: body, response } = await client.GET("/v1/client-policy");
        // Thrown, not returned, so TanStack keeps the previous answer. The
        // status is checked rather than `error`, which openapi-fetch leaves
        // undefined for an empty-bodied non-2xx.
        if (!response.ok) {
          throw new Error(`client-policy answered ${response.status}`);
        }
        const policy = readClientPolicy(body);
        if (!policy) throw new Error("client-policy answered in an unknown shape");
        return policy;
      },
    },
    queryClient,
  );
  return data ?? SUPPORTED;
}
