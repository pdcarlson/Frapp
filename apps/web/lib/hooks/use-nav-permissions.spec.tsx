import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  chapterId: "chap-1" as string | null,
  offline: false,
  read: {
    data: undefined as { permissions: string[] } | undefined,
    isPending: true,
    fetchStatus: "fetching" as "fetching" | "paused" | "idle",
    isError: false,
  },
}));

vi.mock("@repo/hooks", () => ({
  useMyPermissions: () => state.read,
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: state.offline }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId: state.chapterId }),
}));

const { useNavPermissions } = await import("./use-nav-permissions");

describe("useNavPermissions (#3854)", () => {
  beforeEach(() => {
    state.chapterId = "chap-1";
    state.offline = false;
    state.read = { data: undefined, isPending: true, fetchStatus: "fetching", isError: false };
  });

  it("is undefined while the read is in flight, so gated rows wait", () => {
    expect(renderHook(() => useNavPermissions()).result.current).toBeUndefined();
  });

  it("is undefined after an online failure, as <Can> hides", () => {
    state.read = { data: undefined, isPending: false, fetchStatus: "idle", isError: true };
    expect(renderHook(() => useNavPermissions()).result.current).toBeUndefined();
  });

  it("is null when the read is paused offline with nothing cached", () => {
    state.read = { data: undefined, isPending: true, fetchStatus: "paused", isError: false };
    expect(renderHook(() => useNavPermissions()).result.current).toBeNull();
  });

  it("is null when the dashboard is offline and the read has no answer", () => {
    state.offline = true;
    expect(renderHook(() => useNavPermissions()).result.current).toBeNull();
  });

  it("is the answer once there is one, offline or not", () => {
    state.offline = true;
    state.read = {
      data: { permissions: ["members:view"] },
      isPending: false,
      fetchStatus: "idle",
      isError: false,
    };
    expect(renderHook(() => useNavPermissions()).result.current).toEqual(["members:view"]);
  });

  it("is undefined with no active chapter", () => {
    state.chapterId = null;
    state.offline = true;
    expect(renderHook(() => useNavPermissions()).result.current).toBeUndefined();
  });
});
