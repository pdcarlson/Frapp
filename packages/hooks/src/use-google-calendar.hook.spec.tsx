/**
 * The Google Calendar mutations' cache writes (#3322, step 2): what makes the
 * Subscribe menu and sheet change the moment a connection is made or ended.
 * The status query is never invalidated and keeps its value for a minute, so
 * without these writes the row would go on offering to connect after a
 * connect, and read Connected after a disconnect.
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  googleCalendarKeys,
  useConfirmGoogleCalendarConnect,
  useDisconnectGoogleCalendar,
  type GoogleCalendarStatus,
} from "./use-google-calendar";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: vi.fn(),
  useActiveChapterId: vi.fn(),
}));

const CHAPTER = "chapter-1";

const CONNECTED: GoogleCalendarStatus = {
  available: true,
  connected: true,
  status: "active",
  google_email: "member@gmail.com",
  last_synced_at: null,
};

describe("Google Calendar mutations (#3322)", () => {
  let queryClient: QueryClient;
  let post: ReturnType<typeof vi.fn>;
  let del: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient();
    post = vi.fn(async () => ({
      data: CONNECTED,
      error: undefined,
      response: { ok: true, status: 200 },
    }));
    del = vi.fn(async () => ({
      data: undefined,
      error: undefined,
      response: { ok: true, status: 204 },
    }));
    vi.mocked(useFrappClient).mockReturnValue({
      POST: post,
      DELETE: del,
    } as unknown as ReturnType<typeof useFrappClient>);
    vi.mocked(useActiveChapterId).mockReturnValue(CHAPTER);
  });

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  test("a confirmed sign-in becomes the chapter's status at once", async () => {
    queryClient.setQueryData(googleCalendarKeys.chapter(CHAPTER), {
      ...CONNECTED,
      connected: false,
      status: null,
      google_email: null,
    });
    const { result } = renderHook(() => useConfirmGoogleCalendarConnect(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ code: "code-1", state: "state-1" });
    });

    expect(post).toHaveBeenCalledWith("/v1/google-calendar/confirm", {
      body: { code: "code-1", state: "state-1" },
    });
    expect(
      queryClient.getQueryData(googleCalendarKeys.chapter(CHAPTER)),
    ).toEqual(CONNECTED);
  });

  test("a disconnect reads as not connected at once, still offered", async () => {
    queryClient.setQueryData(googleCalendarKeys.chapter(CHAPTER), CONNECTED);
    const { result } = renderHook(() => useDisconnectGoogleCalendar(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(del).toHaveBeenCalledWith("/v1/google-calendar");
    expect(
      queryClient.getQueryData(googleCalendarKeys.chapter(CHAPTER)),
    ).toEqual({
      available: true,
      connected: false,
      status: null,
      google_email: null,
      last_synced_at: null,
    });
  });
});
