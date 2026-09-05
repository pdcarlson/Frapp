/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrappClient } from "@repo/api-sdk";
import {
  useAttendanceReport,
  usePointsReport,
  useRosterReport,
  useServiceReport,
} from "./use-reports";
import { FrappClientProvider } from "./use-frapp-client";

/**
 * These hooks are the only place the `json`/`csv` truncation signal can be
 * read: those formats keep bare bodies on purpose, so the flags travel in
 * response headers and nowhere else. Dropping `response` from the destructure
 * — which is what the code did before — restores a silent-truncation bug that
 * no other test in the repo would notice, so the wiring is pinned here.
 *
 * CI now runs this file: the `web-tests` job in `ci.yml` invokes
 * `npm run test -w packages/hooks`, reached via that job's `packages/**` path
 * filter. Enabling it needed two things that had blocked it — the stale
 * chapter-scoping specs (#766) and the `dist/` collection trap (#762), where a
 * `tsc` build emits CommonJS spec twins that Vitest 4 no longer excludes by
 * default. The latter is handled by the `include` in `vitest.config.ts`, which
 * pins collection to `src`; don't remove it.
 *
 * `web-tests` is a **required** status check, promoted by ADR-15's 2026-08-19
 * amendment because this suite is the only one covering `packages/hooks`. A red
 * run here blocks the merge; do not read it as advisory. The roster lives in
 * `scripts/ci/lib/required-checks.mjs`.
 */
describe("report hooks — truncation signalling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={mockClient as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </FrappClientProvider>
    );
    Wrapper.displayName = "ReportHookWrapper";
    return Wrapper;
  };

  const respondWith = (headers: Record<string, string>, data: unknown = []) =>
    vi.fn().mockResolvedValue({
      data,
      error: undefined,
      response: new Response(null, { headers }),
    });

  it("reads the truncation headers off the response", async () => {
    const mockPost = respondWith(
      {
        "X-Report-Truncated": "true",
        "X-Report-Row-Limit": "5000",
        "X-Report-Truncation-Note": "point balances are incomplete",
      },
      [{ member_name: "Alice" }],
    );

    const { result } = renderHook(() => useAttendanceReport(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    const value = await result.current.mutateAsync({ body: {} });

    expect(value.payload).toEqual([{ member_name: "Alice" }]);
    expect(value.truncation).toEqual({
      truncated: true,
      rowLimit: 5000,
      note: "point balances are incomplete",
    });
  });

  it("reports a complete report when the headers are absent", async () => {
    const mockPost = respondWith({});

    const { result } = renderHook(() => useRosterReport(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    const value = await result.current.mutateAsync({});

    expect(value.truncation).toEqual({
      truncated: false,
      rowLimit: null,
      note: null,
    });
  });

  it.each([
    ["not-a-number", "unparseable"],
    ["", "empty — Number() would make this 0"],
    [" ", "whitespace — Number() would make this 0"],
    ["-5", "negative — would render 'Capped at -5 rows'"],
    ["0x10", "hex — Number() would make this 16"],
    ["1.5", "fractional"],
  ])("treats a malformed row limit (%p, %s) as absent", async (rawLimit) => {
    // The API only ever emits a plain positive integer, so this guards
    // against a proxy rewriting the header rather than against ourselves.
    const mockPost = respondWith({
      "X-Report-Truncated": "true",
      "X-Report-Row-Limit": rawLimit,
    });

    const { result } = renderHook(() => usePointsReport(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    const value = await result.current.mutateAsync({ body: {} });

    // Still known to be short — only the number is untrustworthy.
    expect(value.truncation.truncated).toBe(true);
    expect(value.truncation.rowLimit).toBeNull();
  });

  it("surfaces truncation on every report route, not just one", async () => {
    // Wiring one route and forgetting the others is the likely regression, so
    // each is asserted rather than trusting them to stay in step.
    const headers = {
      "X-Report-Truncated": "true",
      "X-Report-Row-Limit": "5000",
    };
    const wrapper = () => createWrapper({ POST: respondWith(headers) });

    const attendance = renderHook(() => useAttendanceReport(), {
      wrapper: wrapper(),
    });
    const points = renderHook(() => usePointsReport(), { wrapper: wrapper() });
    const roster = renderHook(() => useRosterReport(), { wrapper: wrapper() });
    const service = renderHook(() => useServiceReport(), {
      wrapper: wrapper(),
    });

    const results = [
      ["attendance", await attendance.result.current.mutateAsync({ body: {} })],
      ["points", await points.result.current.mutateAsync({ body: {} })],
      ["roster", await roster.result.current.mutateAsync({})],
      ["service", await service.result.current.mutateAsync({ body: {} })],
    ] as const;

    for (const [route, value] of results) {
      expect(value.truncation.truncated, `${route} route`).toBe(true);
      expect(value.truncation.rowLimit, `${route} route`).toBe(5000);
    }
  });

  it("throws the API error without reaching the headers", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "forbidden" },
      response: new Response(null, { status: 403 }),
    });

    const { result } = renderHook(() => useServiceReport(), {
      wrapper: createWrapper({ POST: mockPost }),
    });

    await expect(
      result.current.mutateAsync({ body: {} }),
    ).rejects.toMatchObject({ message: "forbidden" });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
