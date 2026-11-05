/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { getSignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import {
  ThemedRefreshControl,
  useRefetchAll,
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
    refetches,
    enabled,
    onRefresh,
  }: {
    refetches: (() => Promise<unknown>)[];
    enabled?: boolean;
    onRefresh: (refresh: ScreenRefresh | undefined) => void;
  }) {
    onRefresh(useRefetchAll(refetches, enabled));
    return null;
  }

  it("refetches every query together", async () => {
    const a = vi.fn(() => Promise.resolve("a"));
    const b = vi.fn(() => Promise.resolve("b"));
    let refresh: ScreenRefresh | undefined;
    render(<Probe refetches={[a, b]} onRefresh={(r) => (refresh = r)} />);

    await act(async () => {
      await refresh!();
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to pull while disabled, since refetch ignores enabled", () => {
    let refresh: ScreenRefresh | undefined = () => Promise.resolve();
    render(
      <Probe
        refetches={[() => Promise.resolve()]}
        enabled={false}
        onRefresh={(r) => (refresh = r)}
      />,
    );

    expect(refresh).toBeUndefined();
  });

  it("stays the same callback across renders and calls the latest refetches", async () => {
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    const seen: (ScreenRefresh | undefined)[] = [];
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <Probe refetches={[first]} onRefresh={(r) => seen.push(r)} />,
      );
    });
    act(() => {
      tree.update(
        <Probe refetches={[second]} onRefresh={(r) => seen.push(r)} />,
      );
    });

    expect(seen[0]).toBe(seen[seen.length - 1]);
    await act(async () => {
      await seen[seen.length - 1]!();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
