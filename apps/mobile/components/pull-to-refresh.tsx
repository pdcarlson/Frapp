import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, type RefreshControlProps } from "react-native";
import { useFrappTheme } from "@/lib/theme";

/**
 * What a screen hands its scroll view to refresh: its queries' `refetch`,
 * awaited together. A rejection is the query's to surface (its error state
 * already does), so the pull only waits on it.
 */
export type ScreenRefresh = () => Promise<unknown>;

/**
 * The part of a TanStack query result a pull needs. `isEnabled` is optional
 * only so a spec's stand-in can leave it out; every real result carries it.
 */
export type RefreshableQuery = {
  refetch: (options?: { cancelRefetch?: boolean }) => Promise<unknown>;
  isEnabled?: boolean;
};

/**
 * A screen's refresh: every query it reads, refetched together.
 *
 * Only the queries that are enabled right now are refetched, because a
 * query's `refetch` ignores `enabled` and runs its fetch anyway. A hook's own
 * `enabled` gate (an active chapter, the viewer's id, a non-empty search)
 * therefore holds for the pull too: a viewer-scoped read waiting on
 * `/v1/users/me` would otherwise go out unscoped and fetch the whole
 * chapter's rows. A read whose hook has no gate but that the screen does not
 * show in some state (Tasks' board with no chapter) goes in as `null` there.
 *
 * A pull replaces a fetch already in flight (`cancelRefetch: true`, what a
 * plain `refetch()` does) rather than joining it. The pull is the member
 * saying the screen looks stuck, and nothing else bounds a hung request:
 * neither the API client nor the SDK sets a timeout, so a joined fetch on a
 * dead socket would hold the spinner until the OS gives up on it.
 *
 * Returns a stable callback that reads the latest results, so a screen passes
 * `[query, …]` inline.
 */
export function useRefetchAll(
  queries: readonly (RefreshableQuery | null)[],
): ScreenRefresh {
  const latest = useRef(queries);
  // After commit, not during render: a pull always comes after one.
  useEffect(() => {
    latest.current = queries;
  });
  return useCallback(
    () =>
      Promise.all(
        latest.current
          .filter(
            (query): query is RefreshableQuery =>
              query !== null && query.isEnabled !== false,
          )
          .map((query) => query.refetch({ cancelRefetch: true })),
      ),
    [],
  );
}

/**
 * The spinner tracks the member's pull, not the queries' `isFetching`: a
 * focus or reconnect refetch running underneath must not drag the spinner
 * down on its own, and a pull that finds a refetch already in flight still
 * shows it is working until that one lands.
 */
export function usePullToRefresh(refresh: ScreenRefresh): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setRefreshing(false);
      });
  }, [refresh]);

  return { refreshing, onRefresh };
}

/**
 * The pull-to-refresh control every list uses, in the theme's colours on
 * both platforms: iOS draws its spinner in `tintColor`, Android draws a disc
 * in `progressBackgroundColor` with an arrow in `colors`.
 *
 * Pass it as a scroll view's `refreshControl`. The rest of its props go
 * through to `RefreshControl`, and that matters: on Android the scroll view
 * clones this element with the list itself as its children and a style, so a
 * wrapper that dropped them would draw an empty screen.
 *
 * A scroll view renders a different tree with a control than without one
 * (Android wraps itself in the clone; iOS adds a sibling), so adding or
 * removing the control remounts the whole list. A screen that offers the pull
 * therefore offers it for its whole life, and `useRefetchAll` turns a pull
 * with nothing enabled into a no-op instead of taking the control away.
 */
export function ThemedRefreshControl({
  refresh,
  ...rest
}: { refresh: ScreenRefresh } & Omit<
  RefreshControlProps,
  "refreshing" | "onRefresh"
>) {
  const { tokens } = useFrappTheme();
  const { refreshing, onRefresh } = usePullToRefresh(refresh);
  return (
    <RefreshControl
      tintColor={tokens.color.text.muted}
      colors={[tokens.color.text.muted]}
      progressBackgroundColor={tokens.color.surface.card}
      {...rest}
      refreshing={refreshing}
      onRefresh={onRefresh}
    />
  );
}
