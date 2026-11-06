/** @vitest-environment jsdom */
/**
 * The primer's answers reach analytics as `push-prompt-answered`
 * (`spec/behavior/observability.md` § Push Prompt Telemetry): "Turn on" with
 * what the OS returned, "Not now" as `not_now`, both from `surface: primer`.
 * The primer's own storage and the OS prompt are stand-ins; `primer.spec.ts`
 * and `push.spec.ts` cover them.
 */

import React, { createContext } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TrackFn = (name: string, properties?: Record<string, unknown>) => void;
const analytics = vi.hoisted(() => ({
  context: null as React.Context<TrackFn | null> | null,
}));
vi.mock("@/lib/analytics-provider", () => {
  analytics.context = createContext<TrackFn | null>(null);
  return { AnalyticsContext: analytics.context };
});

const primer = vi.hoisted(() => ({
  acceptPrimer: vi.fn<(onRecorded?: () => void) => Promise<boolean>>(),
  readPrimerDecision: vi.fn(async () => "unasked" as const),
  recordPrimerDecision: vi.fn(async () => {}),
  shouldOfferPrimer: vi.fn(() => true),
}));
vi.mock("@/lib/notifications/primer", () => primer);
vi.mock("@/lib/notifications/push", () => ({
  getPushPermission: vi.fn(async () => ({ granted: false })),
  isPushAvailable: () => true,
}));

const { usePushPrimer } = await import("./use-push-primer");
const { PUSH_PROMPT_ANSWERED_EVENT } = await import("./push-analytics");

function renderWithTrack(track: TrackFn) {
  const Context = analytics.context!;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Context.Provider value={track}>{children}</Context.Provider>
  );
  return renderHook(() => usePushPrimer(), { wrapper });
}

describe("usePushPrimer analytics", () => {
  beforeEach(() => {
    primer.acceptPrimer.mockReset();
  });

  it.each([
    [true, "allowed"],
    [false, "denied"],
  ])("records Turn on as %s → %s", async (granted, answer) => {
    primer.acceptPrimer.mockResolvedValue(granted);
    const track = vi.fn();
    const { result } = renderWithTrack(track);

    await act(async () => {
      await result.current.turnOn();
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer,
      surface: "primer",
    });
  });

  it("records Not now without an OS prompt", async () => {
    const track = vi.fn();
    const { result } = renderWithTrack(track);

    await act(async () => {
      await result.current.notNow();
    });

    expect(primer.acceptPrimer).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer: "not_now",
      surface: "primer",
    });
  });
});
