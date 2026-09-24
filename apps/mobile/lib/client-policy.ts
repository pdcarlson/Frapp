import { useQuery } from "@tanstack/react-query";
import { useFrappClient } from "@repo/hooks";

/**
 * Is this build still supported? (#2526)
 *
 * Asks `GET /v1/client-policy`, which compares the `X-Client-Version` header
 * every request carries (`lib/client-version.ts`) with the deployment's
 * minimum. It runs at launch and again whenever the app returns to the
 * foreground with a stale answer: `lib/connection/query-connectivity.ts`
 * drives TanStack's focus manager from `AppState`, and `refetchOnWindowFocus`
 * is on app-wide (`lib/query-client.ts`).
 *
 * **It fails open.** Only an answer that says `update_required: true` blocks.
 * A network error, a 5xx, a timeout or a response in any other shape is not an
 * answer, so it never blocks, and it never lifts a block an earlier answer
 * set either: TanStack keeps the last successful data through a failed
 * refetch. A later answer saying the build is supported lifts it.
 */

export const CLIENT_POLICY_QUERY_KEY = ["client-policy"] as const;

export interface ClientPolicy {
  updateRequired: boolean;
  /** The https link the update screen opens, or null when there is none to trust. */
  updateUrl: string | null;
}

const SUPPORTED: ClientPolicy = { updateRequired: false, updateUrl: null };

/**
 * The response, read strictly. This binary can't be fixed after it ships, so
 * it trusts nothing it wasn't told exactly: a truthy non-boolean is not `true`,
 * and a link that isn't https is dropped rather than handed to the OS.
 */
export function readClientPolicy(data: unknown): ClientPolicy {
  if (typeof data !== "object" || data === null) return SUPPORTED;
  const { update_required: updateRequired, update_url: updateUrl } =
    data as Record<string, unknown>;
  if (updateRequired !== true) return SUPPORTED;
  return {
    updateRequired: true,
    updateUrl:
      typeof updateUrl === "string" && /^https:\/\//i.test(updateUrl)
        ? updateUrl
        : null,
  };
}

export function useClientPolicy(): ClientPolicy {
  const client = useFrappClient();
  const { data } = useQuery({
    queryKey: CLIENT_POLICY_QUERY_KEY,
    queryFn: async () => {
      const { data: body, error } = await client.GET("/v1/client-policy");
      // Thrown so TanStack keeps the previous answer instead of replacing it.
      if (error) throw new Error("client-policy request failed");
      return readClientPolicy(body);
    },
  });
  return data ?? SUPPORTED;
}
