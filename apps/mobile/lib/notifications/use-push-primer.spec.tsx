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

/** `provided.track` is what the provider holds; change it, then `rerender()`. */
function renderWithTrack(track: TrackFn) {
  const Context = analytics.context!;
  const provided = { track };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Context.Provider value={provided.track}>{children}</Context.Provider>
  );
  return { provided, ...renderHook(() => usePushPrimer(), { wrapper }) };
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

  it("records Turn on with the track that is current when the OS prompt closes", async () => {
    // Right after joining, `track` is the opted-out no-op until the chapter's
    // opt-out read answers, which can land while the OS prompt is up.
    let answer!: (granted: boolean) => void;
    primer.acceptPrimer.mockImplementation(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const before = vi.fn();
    const after = vi.fn();
    const { result, rerender, provided } = renderWithTrack(before);

    let turnedOn!: Promise<boolean>;
    act(() => {
      turnedOn = result.current.turnOn();
    });
    provided.track = after;
    rerender();
    await act(async () => {
      answer(true);
      await turnedOn;
    });

    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer: "allowed",
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
