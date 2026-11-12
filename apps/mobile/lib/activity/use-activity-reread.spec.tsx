/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as expoRouter from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityKeys, activityStandingKeys } from "@repo/hooks";

/**
 * The re-read More and the Activity screen share (#3897): a tab is never
 * unmounted and a pushed screen stays mounted under what it pushes, so both
 * read Activity again when the member comes back to them.
 */

let chapterId: string | null = "chapter-1";
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
}));

import { useActivityReread, useActivityRereadOnTab } from "./use-activity-reread";

/** Every mounted focus effect, run again: the member came back. */
const refocus = (expoRouter as unknown as { __refocus: () => void }).__refocus;

/** The hook's return, handed out through an effect. */
const hook = { reread: () => {} };
function Probe() {
  const reread = useActivityReread();
  React.useEffect(() => {
    hook.reread = reread;
  }, [reread]);
  return null;
}

function StandingProbe() {
  const reread = useActivityReread({ standing: true });
  React.useEffect(() => {
    hook.reread = reread;
  }, [reread]);
  return null;
}

describe("useActivityReread (#3897)", () => {
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;
  let tree: ReactTestRenderer;

  beforeEach(() => {
    chapterId = "chapter-1";
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
    act(() => {
      tree = create(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it("leaves the mount to the query's own read", () => {
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("reads again each time the screen comes back into focus", () => {
    act(() => refocus());
    act(() => refocus());
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
  });

  it("hands back the re-read for a screen's own actions", () => {
    act(() => hook.reread());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("re-reads the standing too when the screen draws it", () => {
    act(() => {
      tree.update(
        <QueryClientProvider client={queryClient}>
          <StandingProbe />
        </QueryClientProvider>,
      );
    });
    act(() => hook.reread());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activityStandingKeys.chapter("chapter-1"),
      exact: true,
    });
  });

  it("reads nothing without a chapter", () => {
    chapterId = null;
    act(() => {
      tree.update(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    act(() => refocus());
    act(() => hook.reread());
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useActivityRereadOnTab (#4610)", () => {
  function TabProbe({ tab }: { tab: string }) {
    useActivityRereadOnTab(tab);
    return null;
  }

  it("reads again on each change of tab, not on the first draw", () => {
    chapterId = "chapter-1";
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const draw = (tab: string) => (
      <QueryClientProvider client={queryClient}>
        <TabProbe tab={tab} />
      </QueryClientProvider>
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(draw("index-1"));
    });
    expect(invalidate).not.toHaveBeenCalled();
    act(() => tree.update(draw("index-1")));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => tree.update(draw("events-1")));
    act(() => tree.update(draw("index-1")));
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith({
      queryKey: activityKeys.chapter("chapter-1"),
      exact: true,
    });
    act(() => tree.unmount());
  });
});
