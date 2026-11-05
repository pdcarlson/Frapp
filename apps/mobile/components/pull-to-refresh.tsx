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
 * A screen's refresh: every query it reads, refetched together, or nothing
 * to pull when the screen has no chapter yet. That gate matters because a
 * disabled query's `refetch` still runs its fetch, and every chapter-scoped
 * hook is disabled until a chapter is active.
 *
 * Returns a stable callback that always calls the latest `refetch`es, so a
 * screen passes `[query.refetch, …]` inline.
 */
export function useRefetchAll(
  refetches: readonly (() => Promise<unknown>)[],
  enabled = true,
): ScreenRefresh | undefined {
  const latest = useRef(refetches);
  // After commit, not during render: a pull always comes after one.
  useEffect(() => {
    latest.current = refetches;
  });
  const refresh = useCallback(
    () => Promise.all(latest.current.map((refetch) => refetch())),
    [],
  );
  return enabled ? refresh : undefined;
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
