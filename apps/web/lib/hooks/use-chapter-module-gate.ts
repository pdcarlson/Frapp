"use client";

import { useCallback } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";
import { readIsOffline } from "@/components/shared/async-states";
import { useRefetchAfterOutage } from "@/lib/hooks/use-refetch-after-outage";
import { useNetwork } from "@/lib/providers/network-provider";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * The module gate for member-facing chrome: the sidebar, the drawer, the Ask
 * pill, the Settings tools list, chat's slash commands, a poll card's Vote
 * (#3012), and a rush card's Vote and Extend bid (#3383).
 *
 * **It reads `enabled_modules` from `GET /v1/chapters/current`, not from
 * `useOrgConfig()`.** The config read (`GET /v1/chapters/:id/config`) is guarded
 * by `chapter-config:view`, which no seeded role below President holds. For an
 * ordinary member that query therefore errors on every load, and a gate built
 * on it failed open for good: members kept seeing rows for modules their
 * chapter had switched off (#1982). Chat's slash gate failed the other way,
 * closed for good, so members saw no module commands at all (#2957). The
 * current-chapter payload is the member view (`toChapterMemberView`), which
 * carries `enabled_modules` for exactly these readers.
 */

/** One identity for "the read failed", so a failed gate never looks like a change. */
const GATE_CLOSED = (): boolean => false;

/**
 * Where the gate's read stands, for a caller that must say which.
 *
 * - `"ready"`: a payload is cached, so the gate answers from it, even while a
 *   refetch is running or after one failed.
 * - `"loading"`: nothing is cached and the read is running, or is about to
 *   (an enabled read with no error that is between attempts or was cancelled
 *   by a newer one).
 * - `"offline"`: nothing is cached and the read can't run, because TanStack
 *   paused it (web queries keep the `"online"` network mode) or because the
 *   dashboard reports OFFLINE while the read retries or has failed.
 * - `"error"`: nothing is cached and nothing is checking. Either the read
 *   failed while the connection was fine, or it is disabled because no
 *   chapter is active.
 *
 * Every state but `"ready"` holds the gate closed. Only `"loading"` resolves
 * by itself, which is why it alone may be drawn as a wait (#3160).
 */
export type ChapterModuleGateStatus = "loading" | "offline" | "error" | "ready";

/** The gate plus where its read stands, for a caller that must say which. */
export interface ChapterModuleGateState {
  status: ChapterModuleGateStatus;
  /** Meaningful only when `status` is `"ready"`. */
  isModuleEnabled: (moduleKey: string) => boolean;
  /** Re-runs the member-view read, for a caller offering a Retry. */
  retry: () => void;
  /**
   * The read's TanStack `fetchStatus`, for the poll card, which derives its
   * gate with `pollsGateOf` in `@repo/chat-core/polls` so that web and mobile
   * share one rule for a Vote.
   */
  fetchStatus: "fetching" | "paused" | "idle";
}

/** The state plus what nav chrome needs to keep #1982's fail-closed rule. */
interface GateRead extends ChapterModuleGateState {
  /** The read ran and failed, with nothing cached. */
  failed: boolean;
}

/**
 * The status for a read with nothing cached. Like `pollsGateOf`'s rule
 * (`@repo/chat-core/polls`), a paused, failed or disabled read is not loading,
 * because nothing will answer it without a Retry. It splits the offline half
 * out of that rule's `"error"`, because the design-system README §4 requires
 * a check that could not run offline to say so, rather than read as a
 * failure. The offline test is `readIsOffline`, the same one every other
 * offline slot uses.
 */
function uncachedStatus(read: {
  enabled: boolean;
  isError: boolean;
  isOffline: boolean;
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}): Exclude<ChapterModuleGateStatus, "ready"> {
  // With no active chapter there is nothing to check, online or not, so the
  // connection is not the reason and the gate simply stays closed.
  if (!read.enabled) return "error";
  // Offline, the read may never pause. TanStack's `onlineManager` only moves
  // on the window's `offline` event, so a page that loaded offline, or an
  // unreachable API, runs the read, retries it and fails it instead (#2267).
  // `readIsOffline` gives that the paused state's branch, as README §4 does.
  if (readIsOffline(read.isOffline, { data: undefined, ...read })) {
    return "offline";
  }
  return read.isError && read.fetchStatus !== "fetching" ? "error" : "loading";
}

function useGateRead(): GateRead {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const enabled = !!activeChapterId;
  const chapterQuery = useCurrentChapter({
    chapterId: activeChapterId,
    enabled,
  });
  const { isOffline } = useNetwork();
  const loaded = chapterQuery.data !== undefined;
  const enabledModules = (
    chapterQuery.data as
      | { enabled_modules?: Record<string, boolean> | null }
      | undefined
  )?.enabled_modules;

  const gate = useCallback(
    (moduleKey: string) => isModuleEnabled(enabledModules, moduleKey),
    [enabledModules],
  );
  const { refetch, fetchStatus, isError, isPending } = chapterQuery;
  const retry = useCallback(() => void refetch(), [refetch]);
  useRefetchAfterOutage({ isOffline, enabled, isError, loaded, refetch });

  if (loaded) {
    return {
      status: "ready",
      isModuleEnabled: gate,
      retry,
      fetchStatus,
      failed: false,
    };
  }
  return {
    status: uncachedStatus({
      enabled,
      isError,
      isOffline,
      isPending,
      fetchStatus,
    }),
    isModuleEnabled: GATE_CLOSED,
    retry,
    fetchStatus,
    failed: enabled && isError,
  };
}

/**
 * The gate with its read state, for a caller that must refuse differently
 * while the read is pending, offline or failed than when a module is off:
 * chat's slash palette and composer (#2993), and the poll card's Vote (#3012).
 * Nav chrome wants {@link useChapterModuleGate}.
 *
 * A failed refetch with a cached payload still answers `"ready"` from the
 * cache.
 */
export function useChapterModuleGateState(): ChapterModuleGateState {
  const { status, isModuleEnabled: gate, retry, fetchStatus } = useGateRead();
  return { status, isModuleEnabled: gate, retry, fetchStatus };
}

/**
 * The gate for nav chrome. Returns `undefined`, which callers treat as "do not
 * gate" (`isNavItemVisible`), until the read either answers or fails. So
 * nothing flashes out of the nav on first paint, including the server render
 * and hydration, where no chapter is active yet, and a read paused offline
 * keeps its rows rather than hiding modules the chapter never switched off
 * (design-system README §5 rule 4). The offline banner already says why the
 * rows can't be checked.
 *
 * Once the read has **failed**, the gate closes: a module row it cannot vouch
 * for would lead to a route `ChapterGuard` refuses (#1982).
 */
export function useChapterModuleGate():
  | ((moduleKey: string) => boolean)
  | undefined {
  const { status, failed, isModuleEnabled: gate } = useGateRead();
  if (status === "ready" || failed) return gate;
  return undefined;
}
