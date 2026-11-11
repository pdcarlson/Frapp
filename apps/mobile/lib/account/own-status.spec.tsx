/** @vitest-environment jsdom */
/**
 * What a failed settings read answers (#3917): Online for the ME button and
 * the status sheet, but nothing at all for presence, because the phone keeps
 * no last-seen status and a saved Invisible must not go out as Online.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: {} as { data?: unknown; isError?: boolean },
}));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  AppState: { currentState: "active", addEventListener: vi.fn() },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@repo/hooks", async () => {
  const { useOwnStatusAt } = await import("@repo/hooks/use-own-status-at");
  return {
    useOwnStatusAt,
    useUserSettings: () => ({ data: undefined, isError: false, ...state.settings }),
    useUpdateUserSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
    userSettingsKey: ["settings"],
  };
});

const { useOwnStatus } = await import("./own-status");

beforeEach(() => {
  state.settings = {};
});

describe("useOwnStatus", () => {
  it("is unknown while the first read is in flight", () => {
    const { result } = renderHook(() => useOwnStatus());
    expect(result.current).toBeNull();
  });

  it("answers Online after a failed read, so the sheet stays usable", () => {
    state.settings = { isError: true };
    const { result } = renderHook(() => useOwnStatus());
    expect(result.current?.status).toBe("online");
  });

  it("stays unknown after a failed read when presence asks", () => {
    state.settings = { isError: true };
    const { result } = renderHook(() => useOwnStatus({ unknownOnError: true }));
    expect(result.current).toBeNull();
  });

  it("reads a saved Invisible either way", () => {
    state.settings = { data: { status: "invisible" } };
    const { result } = renderHook(() => useOwnStatus({ unknownOnError: true }));
    expect(result.current?.status).toBe("invisible");
  });
});
