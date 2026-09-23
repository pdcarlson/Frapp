import { useLegalAcceptance, useListChapters } from "@repo/hooks";
import {
  resolveAuthGate,
  toAuthGateInput,
  type AuthGateDestination,
} from "@/lib/auth-gate";
import { useAuthSession } from "@/lib/auth-session";

/**
 * The live input `resolveAuthGate` needs, read once so `(auth)/_layout.tsx`
 * and `AppRuntime` cannot drift. The mapping from query state to gate input is
 * `toAuthGateInput`, which is pure and tested in `lib/auth-gate.spec.ts`.
 *
 * `(tabs)/_layout.tsx` is frozen and still calls `resolveAuthGate` with only
 * the session — it does not have to know about join/welcome. Walking a member
 * *out* of the tabs onto those screens is `AppRuntime`'s job.
 */
export function useAuthGateDestination(): AuthGateDestination {
  const { status, chapterId, isChapterResolving } = useAuthSession();
  const chapters = useListChapters({ enabled: status === "authenticated" });
  const legal = useLegalAcceptance({ enabled: status === "authenticated" });

  return resolveAuthGate(
    toAuthGateInput({
      session: { status, chapterId, isChapterResolving },
      chapters: {
        data: Array.isArray(chapters.data) ? chapters.data : undefined,
        isError: chapters.isError,
        isSuccess: chapters.isSuccess,
        errorUpdateCount: chapters.errorUpdateCount,
      },
      legal: {
        data: legal.data,
        isError: legal.isError,
        errorUpdateCount: legal.errorUpdateCount,
      },
    }),
  );
}
