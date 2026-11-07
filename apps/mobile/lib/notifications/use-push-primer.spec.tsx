/** @vitest-environment jsdom */
/**
 * The primer's answers reach analytics as `push-prompt-answered`
 * (`spec/behavior/observability.md` § Push Prompt Telemetry): "Turn on" with
 * what the OS returned, "Not now" as `not_now`, both from `surface: primer`,
 * and the chat home's reminder from `surface: reminder`.
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

type Outcome = "allowed" | "denied" | "settings";
const primer = vi.hoisted(() => ({
  answerPushAsk: vi.fn<(onRecorded?: () => void) => Promise<Outcome>>(),
  declinePrimer: vi.fn(async () => {}),
  readDeclinedAt: vi.fn(async () => null),
  readPrimerDecision: vi.fn(async () => "unasked" as const),
  readReminderDone: vi.fn(async () => false),
  recordReminderDone: vi.fn(async () => {}),
  onStoredAnswerChange: vi.fn(() => () => {}),
  shouldOfferPrimer: vi.fn(() => true),
  shouldOfferReminder: vi.fn(() => true),
}));
vi.mock("@/lib/notifications/primer", () => primer);
vi.mock("@/lib/notifications/push", () => ({
  isPushAvailable: () => true,
}));
vi.mock("@/lib/notifications/push-state", () => ({
  readPushState: vi.fn(async () => ({
    granted: false,
    canAskAgain: true,
    status: "undetermined",
    channelBlocked: false,
  })),
  pushIsOn: () => false,
  pushTapAsks: () => true,
}));

const { usePushPrimer, usePushReminder } = await import("./use-push-primer");
const { PUSH_PROMPT_ANSWERED_EVENT } = await import("./push-analytics");

/** `provided.track` is what the provider holds; change it, then `rerender()`. */
async function renderWithTrack(track: TrackFn) {
  const Context = analytics.context!;
  const provided = { track };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Context.Provider value={provided.track}>{children}</Context.Provider>
  );
  const rendered = renderHook(() => usePushPrimer(), { wrapper });
  // Let the stored answers and the push state land, as a screen would.
  await act(async () => {});
  return { provided, ...rendered };
}

describe("usePushPrimer analytics", () => {
  beforeEach(() => {
    primer.answerPushAsk.mockReset();
    primer.declinePrimer.mockClear();
  });

  it.each([
    [true, "allowed"],
    [false, "denied"],
  ])("records Turn on as %s → %s", async (granted, answer) => {
    primer.answerPushAsk.mockResolvedValue(granted ? "allowed" : "denied");
    const track = vi.fn();
    const { result } = await renderWithTrack(track);

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
    let answer!: (outcome: Outcome) => void;
    primer.answerPushAsk.mockImplementation(
      () => new Promise<Outcome>((resolve) => (answer = resolve)),
    );
    const before = vi.fn();
    const after = vi.fn();
    const { result, rerender, provided } = await renderWithTrack(before);

    let turnedOn!: Promise<Outcome | null>;
    act(() => {
      turnedOn = result.current.turnOn();
    });
    provided.track = after;
    rerender();
    await act(async () => {
      answer("allowed");
      await turnedOn;
    });

    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer: "allowed",
      surface: "primer",
    });
  });

  // A second tap while the first answer is stored would send a second event,
  // or show the OS dialog after the member said Not now.
  it("takes one answer per step", async () => {
    let answer!: (outcome: Outcome) => void;
    primer.answerPushAsk.mockImplementation(
      () => new Promise<Outcome>((resolve) => (answer = resolve)),
    );
    const track = vi.fn();
    const { result } = await renderWithTrack(track);

    let first!: Promise<Outcome | null>;
    act(() => {
      first = result.current.turnOn();
    });
    let second: Outcome | null = "allowed";
    let notNow = true;
    await act(async () => {
      second = await result.current.turnOn();
      notNow = await result.current.notNow();
    });
    await act(async () => {
      answer("allowed");
      await first;
    });

    expect(second).toBeNull();
    expect(notNow).toBe(false);
    expect(primer.answerPushAsk).toHaveBeenCalledTimes(1);
    expect(primer.declinePrimer).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
  });

  // A storage failure must not strand the member on the step: every later
  // tap would be taken as a second answer and do nothing.
  it("moves on, untracked, when storing the answer fails", async () => {
    primer.answerPushAsk.mockRejectedValue(new Error("storage"));
    const track = vi.fn();
    const { result } = await renderWithTrack(track);

    let outcome: Outcome | null = null;
    await act(async () => {
      outcome = await result.current.turnOn();
    });

    expect(outcome).toBe("denied");
    expect(track).not.toHaveBeenCalled();
  });

  it("records Not now without an OS prompt", async () => {
    const track = vi.fn();
    const { result } = await renderWithTrack(track);

    await act(async () => {
      await result.current.notNow();
    });

    expect(primer.answerPushAsk).not.toHaveBeenCalled();
    expect(primer.declinePrimer).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer: "not_now",
      surface: "primer",
    });
  });

  // The phone's settings opened: the answer happens out there, and the
  // reminder or Settings reads it on return, so no event is sent.
  it("records nothing when the tap opened the phone's settings", async () => {
    primer.answerPushAsk.mockResolvedValue("settings");
    const track = vi.fn();
    const { result } = await renderWithTrack(track);

    await act(async () => {
      await result.current.turnOn();
    });

    expect(track).not.toHaveBeenCalled();
  });
});

describe("usePushReminder", () => {
  async function renderReminder(track: TrackFn) {
    const Context = analytics.context!;
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Context.Provider value={track}>{children}</Context.Provider>
    );
    const rendered = renderHook(() => usePushReminder(), { wrapper });
    await act(async () => {});
    return rendered;
  }

  beforeEach(() => {
    primer.answerPushAsk.mockReset();
    primer.recordReminderDone.mockClear();
  });

  it("records Turn on from the reminder surface, and answers it for good", async () => {
    primer.answerPushAsk.mockImplementation(async (onRecorded) => {
      onRecorded?.();
      return "allowed";
    });
    const track = vi.fn();
    const { result } = await renderReminder(track);
    expect(result.current.show).toBe(true);

    await act(async () => {
      await result.current.turnOn();
    });

    expect(primer.recordReminderDone).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer: "allowed",
      surface: "reminder",
    });
  });

  it("records a dismiss as not_now and never asks again", async () => {
    const track = vi.fn();
    const { result } = await renderReminder(track);

    act(() => {
      result.current.dismiss();
    });

    expect(primer.answerPushAsk).not.toHaveBeenCalled();
    expect(primer.recordReminderDone).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(PUSH_PROMPT_ANSWERED_EVENT, {
      answer: "not_now",
      surface: "reminder",
    });
  });
});
