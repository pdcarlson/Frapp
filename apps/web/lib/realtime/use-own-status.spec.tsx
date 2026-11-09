import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  value: { data: undefined as unknown, isError: false },
}));
vi.mock("@repo/hooks", async () => ({
  // The real end-time timer, shared with mobile.
  useOwnStatusAt: (await import("@repo/hooks/use-own-status-at"))
    .useOwnStatusAt,
  useUserSettings: () => settings.value,
  useUpdateUserSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  userSettingsKey: ["settings"],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "me" }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useOwnStatus } from "./use-own-status";

const NOW = Date.parse("2026-11-09T15:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  settings.value = { data: undefined, isError: false };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useOwnStatus", () => {
  it("is null while the settings read is in flight, so nothing publishes", () => {
    const { result } = renderHook(() => useOwnStatus());
    expect(result.current).toBeNull();
  });

  // The hook is what ends a 1-hour DND, or a line, on the wire.
  it("ends a status and a line at their end times, with no refetch", () => {
    settings.value = {
      data: {
        status: "dnd",
        status_expires_at: new Date(NOW + 60 * 60 * 1000).toISOString(),
        custom_status: "Studying",
        custom_status_expires_at: new Date(NOW + 30 * 60 * 1000).toISOString(),
      },
      isError: false,
    };
    const { result } = renderHook(() => useOwnStatus());
    expect(result.current).toMatchObject({ status: "dnd", line: "Studying" });

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });
    expect(result.current).toMatchObject({ status: "dnd", line: null });

    act(() => {
      vi.advanceTimersByTime(30 * 60 * 1000);
    });
    expect(result.current).toMatchObject({ status: "online", line: null });
  });

  it("doesn't end a status early when its end is past the timer's 32-bit cap", () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    settings.value = {
      data: {
        status: "dnd",
        status_expires_at: new Date(NOW + thirtyDays).toISOString(),
      },
      isError: false,
    };
    const { result } = renderHook(() => useOwnStatus());
    act(() => {
      vi.advanceTimersByTime(2_147_483_647);
    });
    expect(result.current?.status).toBe("dnd");
  });

  // Presence must not depend on API health.
  it("falls back to the status this browser last saw when the read fails", () => {
    settings.value = { data: { status: "invisible" }, isError: false };
    const first = renderHook(() => useOwnStatus());
    expect(first.result.current?.status).toBe("invisible");
    first.unmount();

    settings.value = { data: undefined, isError: true };
    const { result } = renderHook(() => useOwnStatus());
    expect(result.current?.status).toBe("invisible");
  });

  it("falls back to automatic Online when the read fails with nothing seen", () => {
    settings.value = { data: undefined, isError: true };
    const { result } = renderHook(() => useOwnStatus());
    expect(result.current?.status).toBe("online");
  });
});
