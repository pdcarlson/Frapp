/**
 * `useEventCardExcuse` (#4660): a chat event card offers Can't make it only
 * when the card's own role fields (or the Activity page's `viewer_required`)
 * say the event requires the viewer, and a card that doesn't reads no excuse
 * or attendance row.
 */
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  useEventCardExcuse,
  useRequiredOfViewer,
  type ExcuseCardEvent,
} from "./use-event-excuses";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { useListChapters } from "./use-chapters";
import { useRoles } from "./use-roles";

vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: vi.fn(),
  useActiveChapterId: vi.fn(),
}));
vi.mock("./use-chapters", () => ({ useListChapters: vi.fn() }));
vi.mock("./use-roles", () => ({ useRoles: vi.fn() }));

const NOW = new Date("2026-11-13T12:00:00.000Z");

const card = (fields: Partial<ExcuseCardEvent> = {}): ExcuseCardEvent => ({
  event_id: "evt-1",
  start_time: "2026-11-14T23:00:00.000Z",
  end_time: "2026-11-15T00:00:00.000Z",
  check_in_opens_minutes: 10,
  is_mandatory: false,
  ...fields,
});

describe("useEventCardExcuse (#4660)", () => {
  let queryClient: QueryClient;
  let get: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    get = vi.fn(async (path: string) => {
      if (path === "/v1/events/{eventId}/excuses/me") {
        return {
          data: { excuse: null, receiver: null },
          error: undefined,
          response: { ok: true, status: 200 },
        };
      }
      return {
        data: { attendance: null },
        error: undefined,
        response: { ok: true, status: 200 },
      };
    });
    vi.mocked(useFrappClient).mockReturnValue({
      GET: get,
    } as unknown as ReturnType<typeof useFrappClient>);
    vi.mocked(useActiveChapterId).mockReturnValue("ch-1");
    vi.mocked(useListChapters).mockReturnValue({
      data: [{ chapter_id: "ch-1", role_ids: ["role-new"] }],
    } as unknown as ReturnType<typeof useListChapters>);
    vi.mocked(useRoles).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof useRoles>);
  });

  afterEach(() => queryClient.clear());

  function render(event: ExcuseCardEvent | null, now = NOW) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(
      () => useEventCardExcuse(event, now, useRequiredOfViewer()),
      { wrapper },
    );
  }

  test("offers Can't make it on a card whose roles require the viewer", async () => {
    const { result } = render(
      card({
        required_role_ids: ["role-new"],
        optional_role_ids: [],
        excluded_role_ids: [],
        others_invited: true,
      }),
    );

    await waitFor(() => expect(result.current).toEqual({ kind: "offer" }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("offers it on an older card that is only marked mandatory", async () => {
    const { result } = render(card({ is_mandatory: true }));

    await waitFor(() => expect(result.current).toEqual({ kind: "offer" }));
  });

  test("goes by the Activity page's answer for an alumnus held by role", async () => {
    // An alumnus: the default alone never holds them, and the Activity row
    // has no role lists to show the role that does. The server already said.
    vi.mocked(useRoles).mockReturnValue({
      data: [{ id: "role-alumni", name: "Alumni", system_key: "ALUMNI" }],
    } as unknown as ReturnType<typeof useRoles>);
    vi.mocked(useListChapters).mockReturnValue({
      data: [{ chapter_id: "ch-1", role_ids: ["role-alumni"] }],
    } as unknown as ReturnType<typeof useListChapters>);

    // Without the answer, the default alone doesn't hold an alumnus.
    expect(render(card({ is_mandatory: true })).result.current).toEqual({
      kind: "none",
    });

    const { result } = render(
      card({ is_mandatory: true, viewer_required: true }),
    );
    await waitFor(() => expect(result.current).toEqual({ kind: "offer" }));
  });

  test("an Activity card that says not required reads nothing", () => {
    const { result } = render(
      card({ is_mandatory: true, viewer_required: false }),
    );

    expect(result.current).toEqual({ kind: "none" });
    expect(get).not.toHaveBeenCalled();
  });

  test("reads nothing for an optional event", () => {
    const { result } = render(card());

    expect(result.current).toEqual({ kind: "none" });
    expect(get).not.toHaveBeenCalled();
  });

  test("reads nothing once the excuse window has closed", () => {
    const { result } = render(
      card({ is_mandatory: true }),
      new Date("2026-11-20T00:00:00.000Z"),
    );

    expect(result.current).toEqual({ kind: "none" });
    expect(get).not.toHaveBeenCalled();
  });

  test("reads nothing for a card that didn't read", () => {
    const { result } = render(null);

    expect(result.current).toEqual({ kind: "none" });
    expect(get).not.toHaveBeenCalled();
  });
});
