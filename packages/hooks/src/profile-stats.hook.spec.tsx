/**
 * `useMyProfileStats`, as both apps' Profile mounts it. The service read is
 * scoped to the viewer and waits for their id: unscoped, the endpoint hands a
 * `service:approve` holder every entry in the chapter, and the card presents
 * the total as the viewer's own. Moved here from the phone's Profile spec when
 * web's Profile took the same cards (#4137).
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useMyProfileStats } from "./profile-stats";
import { useMyPoints } from "./use-points";
import { useServiceEntries } from "./use-service-entries";
import { useMyPermissions, useViewerUserId } from "./use-user";
import { useActiveChapterId } from "./use-frapp-client";

vi.mock("./use-frapp-client", () => ({ useActiveChapterId: vi.fn() }));
vi.mock("./use-points", () => ({ useMyPoints: vi.fn() }));
vi.mock("./use-service-entries", () => ({ useServiceEntries: vi.fn() }));
vi.mock("./use-user", () => ({
  useMyPermissions: vi.fn(),
  useViewerUserId: vi.fn(),
}));

function grant(permissions: string[] | undefined) {
  vi.mocked(useMyPermissions).mockReturnValue({
    data: permissions === undefined ? undefined : { permissions },
  } as unknown as ReturnType<typeof useMyPermissions>);
}

describe("useMyProfileStats (#4137)", () => {
  beforeEach(() => {
    grant(["members:view"]);
    vi.mocked(useActiveChapterId).mockReturnValue("chapter-1");
    vi.mocked(useMyPoints).mockReturnValue({
      data: { balance: 1240, transactions: [] },
      isError: false,
    } as unknown as ReturnType<typeof useMyPoints>);
    vi.mocked(useServiceEntries).mockReturnValue({
      data: [
        { status: "APPROVED", duration_minutes: 90 },
        { status: "PENDING", duration_minutes: 600 },
      ],
      isError: false,
    } as unknown as ReturnType<typeof useServiceEntries>);
    vi.mocked(useServiceEntries).mockClear();
    vi.mocked(useMyPoints).mockClear();
  });

  test("asks for the viewer's own entries once the viewer is known", () => {
    vi.mocked(useViewerUserId).mockReturnValue("user-1");
    const { result } = renderHook(() => useMyProfileStats());
    for (const [userId, , options] of vi.mocked(useServiceEntries).mock.calls) {
      expect(userId).toBe("user-1");
      expect(options?.enabled).toBe(true);
    }
    expect(result.current).toEqual({
      points: 1240,
      serviceHours: "1.5",
      hasChapter: true,
      visible: true,
      pointsFailed: false,
      serviceFailed: false,
    });
  });

  test("sends nothing while the viewer is still unknown", () => {
    vi.mocked(useViewerUserId).mockReturnValue(null);
    renderHook(() => useMyProfileStats());
    expect(vi.mocked(useServiceEntries).mock.calls.length).toBeGreaterThan(0);
    for (const [, , options] of vi.mocked(useServiceEntries).mock.calls) {
      expect(options?.enabled).toBe(false);
    }
  });

  test("says when there is no chapter to read points in", () => {
    vi.mocked(useActiveChapterId).mockReturnValue(null);
    vi.mocked(useViewerUserId).mockReturnValue("user-1");
    const { result } = renderHook(() => useMyProfileStats());
    expect(result.current.hasChapter).toBe(false);
  });

  test("says a read failed only when it has no number to show", () => {
    vi.mocked(useViewerUserId).mockReturnValue("user-1");
    vi.mocked(useMyPoints).mockReturnValue({
      data: undefined,
      isError: true,
    } as unknown as ReturnType<typeof useMyPoints>);
    // A failed background refetch keeps the last answer (TanStack v5): the
    // number stands, and a "couldn't load" note under it would contradict it.
    vi.mocked(useServiceEntries).mockReturnValue({
      data: [{ status: "APPROVED", duration_minutes: 60 }],
      isError: true,
    } as unknown as ReturnType<typeof useServiceEntries>);
    const { result } = renderHook(() => useMyProfileStats());
    expect(result.current.pointsFailed).toBe(true);
    expect(result.current.points).toBeNull();
    expect(result.current.serviceFailed).toBe(false);
    expect(result.current.serviceHours).toBe("1");
  });

  test("sends neither read, and hides the cards, without members:view", () => {
    grant(["service:log"]);
    vi.mocked(useViewerUserId).mockReturnValue("user-1");
    const { result } = renderHook(() => useMyProfileStats());
    for (const [, , options] of vi.mocked(useMyPoints).mock.calls) {
      expect(options?.enabled).toBe(false);
    }
    for (const [, , options] of vi.mocked(useServiceEntries).mock.calls) {
      expect(options?.enabled).toBe(false);
    }
    expect(result.current.visible).toBe(false);
  });

  test("waits for the permissions before reading, with the cards still shown", () => {
    grant(undefined);
    vi.mocked(useViewerUserId).mockReturnValue("user-1");
    const { result } = renderHook(() => useMyProfileStats());
    expect(vi.mocked(useMyPoints).mock.calls.length).toBeGreaterThan(0);
    for (const [, , options] of vi.mocked(useMyPoints).mock.calls) {
      expect(options?.enabled).toBe(false);
    }
    expect(result.current.visible).toBe(true);
  });
});
