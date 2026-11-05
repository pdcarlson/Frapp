/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { getSignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ThemedRefreshControl,
  useRefetchAll,
  type RefreshableQuery,
  type ScreenRefresh,
} from "./pull-to-refresh";

/**
 * #3385. The host-string casts are the ones
 * `lib/onboarding/join-screen.spec.tsx` explains.
 */

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return tree;
}

function control(tree: ReactTestRenderer) {
  return tree.root.findByType("RefreshControl" as unknown as React.ElementType);
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ThemedRefreshControl (#3385)", () => {
  it("draws the spinner in the theme's tokens on both platforms", () => {
    const tree = render(
      <ThemedRefreshControl refresh={() => Promise.resolve()} />,
    );
    const tokens = getSignetTokens();

    expect(control(tree).props).toMatchObject({
      tintColor: tokens.color.text.muted,
      colors: [tokens.color.text.muted],
      progressBackgroundColor: tokens.color.surface.card,
      refreshing: false,
    });
  });

  it("spins from the pull until the refresh settles", async () => {
    const pending = deferred();
    const refresh = vi.fn<ScreenRefresh>(() => pending.promise);
    const tree = render(<ThemedRefreshControl refresh={refresh} />);

    act(() => control(tree).props.onRefresh());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(control(tree).props.refreshing).toBe(true);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(control(tree).props.refreshing).toBe(false);
  });

  it("stops spinning when the refresh rejects, which the query's error state shows", async () => {
    const pending = deferred();
    const tree = render(
      <ThemedRefreshControl refresh={() => pending.promise} />,
    );

    act(() => control(tree).props.onRefresh());
    await act(async () => {
      pending.reject(new Error("offline"));
      await pending.promise.catch(() => undefined);
    });
    expect(control(tree).props.refreshing).toBe(false);
  });

  it("passes the scroll view's clone props through, so Android still draws the list", () => {
    // ScrollView on Android clones its refreshControl with the list as
    // children and a style; a wrapper that dropped them draws nothing.
    const tree = render(
      <ThemedRefreshControl
        refresh={() => Promise.resolve()}
        style={{ flex: 1 }}
      >
        <Text>List</Text>
      </ThemedRefreshControl>,
    );

    expect(control(tree).props.style).toEqual({ flex: 1 });
    expect(tree.root.findByType(Text).props.children).toBe("List");
  });
});

describe("useRefetchAll (#3385)", () => {
  function Probe({
    queries,
    onRefresh,
  }: {
    queries: RefreshableQuery[];
    onRefresh: (refresh: ScreenRefresh) => void;
  }) {
    onRefresh(useRefetchAll(queries));
    return null;
  }

  const query = (isEnabled?: boolean) => ({
    refetch: vi.fn(() => Promise.resolve()),
    ...(isEnabled === undefined ? {} : { isEnabled }),
  });

  it("refetches every enabled query together, joining one already in flight", async () => {
    const a = query(true);
    const b = query();
    let refresh!: ScreenRefresh;
    render(<Probe queries={[a, b]} onRefresh={(r) => (refresh = r)} />);

    await act(async () => {
      await refresh();
    });
    expect(a.refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
    expect(b.refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
  });

  it("skips a disabled query, since refetch ignores enabled", async () => {
    const on = query(true);
    const off = query(false);
    let refresh!: ScreenRefresh;
    render(<Probe queries={[on, off]} onRefresh={(r) => (refresh = r)} />);

    await act(async () => {
      await refresh();
    });
    expect(on.refetch).toHaveBeenCalledTimes(1);
    expect(off.refetch).not.toHaveBeenCalled();
  });

  it("stays the same callback across renders and reads the latest queries", async () => {
    const first = query(true);
    const second = query(true);
    const seen: ScreenRefresh[] = [];
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <Probe queries={[first]} onRefresh={(r) => seen.push(r)} />,
      );
    });
    act(() => {
      tree.update(<Probe queries={[second]} onRefresh={(r) => seen.push(r)} />);
    });

    expect(seen[0]).toBe(seen[seen.length - 1]);
    await act(async () => {
      await seen[seen.length - 1]!();
    });
    expect(first.refetch).not.toHaveBeenCalled();
    expect(second.refetch).toHaveBeenCalledTimes(1);
  });

  it("never fetches a real query its hook keeps off", async () => {
    // Against TanStack itself, not a stand-in: the guarantee rests on
    // `isEnabled` mirroring `enabled`, which a mock cannot prove.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const gated = vi.fn(() => Promise.resolve("whole ledger"));
    const open = vi.fn(() => Promise.resolve("mine"));
    let refresh!: ScreenRefresh;
    function Screen() {
      const off = useQuery({
        queryKey: ["off"],
        queryFn: gated,
        enabled: false,
      });
      const on = useQuery({ queryKey: ["on"], queryFn: open });
      refresh = useRefetchAll([off, on]);
      return null;
    }
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    open.mockClear();

    await act(async () => {
      await refresh();
    });
    expect(gated).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
