"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCurrentChapter } from "@repo/hooks";
import { isModuleEnabled } from "@repo/validation";
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
 * - `"loading"`: nothing is cached and the read is actually running.
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

/**
 * The status for a read with nothing cached. This is `pollsGateOf`'s rule
 * (`@repo/chat-core/polls`): only a running read is loading, and a paused,
 * failed or disabled one is not, because nothing will answer it without a
 * Retry. It splits the offline half out of that rule's `"error"`, because the
 * design-system README §4 requires a check that could not run offline to say
 * so, rather than read as a failure.
 */
function uncachedStatus(read: {
  enabled: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
  isOffline: boolean;
}): Exclude<ChapterModuleGateStatus, "ready"> {
  // With no active chapter there is nothing to check, online or not, so the
  // connection is not the reason and the gate simply stays closed.
  if (!read.enabled) return "error";
  if (read.fetchStatus === "paused") return "offline";
  // Offline, the read may never pause. TanStack's `onlineManager` only moves
  // on the window's `offline` event, so a page that loaded offline, or an
  // unreachable API, runs the read, retries it and fails it instead (#2267).
  // That is the paused state by another route, and README §4 gives it the
  // same branch.
  if (read.isOffline) return "offline";
  return read.fetchStatus === "fetching" ? "loading" : "error";
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
  const { refetch, fetchStatus, isError } = chapterQuery;
  const retry = useCallback(() => void refetch(), [refetch]);

  // A paused read resumes by itself when TanStack sees the connection return.
  // One that failed while the dashboard was OFFLINE does not, because TanStack
  // never saw an outage to recover from. So the gate re-runs it when
  // `useNetwork()` leaves OFFLINE, or the member's reconnect would land on a
  // failed check that nobody re-ran. `cancelRefetch: false` because every
  // gated row on the page runs this effect for the same query, and the
  // default would have each call abort the one before it.
  const wasOffline = useRef(isOffline);
  useEffect(() => {
    const recovered = wasOffline.current && !isOffline;
    wasOffline.current = isOffline;
    if (recovered && enabled && isError && !loaded) {
      void refetch({ cancelRefetch: false });
    }
  }, [isOffline, enabled, isError, loaded, refetch]);

  if (loaded) {
    return { status: "ready", isModuleEnabled: gate, retry, fetchStatus };
  }
  return {
    status: uncachedStatus({ enabled, fetchStatus, isOffline }),
    isModuleEnabled: GATE_CLOSED,
    retry,
    fetchStatus,
  };
}

/**
 * The gate for nav chrome. Returns `undefined` only while the read is actually
 * running with nothing cached. Callers treat that as "do not gate", so nothing
 * flashes out of the nav on first paint (`isNavItemVisible`).
 *
 * Every other uncached state closes the gate: a read that failed, one that is
 * paused or failed offline, and one that is disabled because no chapter is
 * active. None of them answers by itself, so treating them as "do not gate"
 * would advertise module rows indefinitely, each leading to a route
 * `ChapterGuard` refuses. This is README §4's "Idle with nothing cached still
 * fails closed". An offline nav says nothing per row, because the dashboard's
 * offline banner already states it, and the rows return when the read answers.
 */
export function useChapterModuleGate():
  | ((moduleKey: string) => boolean)
  | undefined {
  const { status, isModuleEnabled: gate } = useChapterModuleGateState();
  return status === "loading" ? undefined : gate;
}
