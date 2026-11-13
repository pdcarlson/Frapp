/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import {
  releaseStartupSheet,
  requestStartupSheet,
  resetStartupSheetsForTests,
} from "@/lib/startup-sheets";

/**
 * Meet Frapp AI, once on next open, for an account that never answered it
 * (#4790). It waits for What's new and sits out a launch the tour owns.
 */

const state = vi.hoisted(() => ({
  consent: undefined as unknown,
  tourDue: false,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => ({ data: state.consent }),
  useCurrentUser: () => ({ data: { id: "u-1" } }),
}));
vi.mock("@/lib/onboarding/tour", () => ({
  isTourDue: () => Promise.resolve(state.tourDue),
}));
// The sheet itself has its own spec (`meet-frapp-ai.spec.tsx`).
const sheet = vi.hoisted(() => ({ present: vi.fn() }));
vi.mock("@/components/ai/meet-frapp-ai", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    MeetFrappAiSheet: forwardRef(function MeetFrappAiSheet(
      props: { onClosed?: () => void },
      ref,
    ) {
      useImperativeHandle(ref, () => sheet);
      return React.createElement("MeetFrappAiSheet", props);
    }),
  };
});

import {
  MEET_FRAPP_AI_OPEN_DELAY_MS,
  MeetFrappAiHost,
} from "./meet-frapp-ai-host";

const UNANSWERED = {
  answer: null,
  answered_at: null,
  sheet_changed: false,
  sheet: { version: 2, providers: [], data: [] },
};

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MeetFrappAiHost />
      </FrappThemeProvider>,
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MEET_FRAPP_AI_OPEN_DELAY_MS + 10);
  });
  return tree;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStartupSheetsForTests();
  state.consent = UNANSWERED;
  state.tourDue = false;
  sheet.present.mockClear();
});

describe("MeetFrappAiHost", () => {
  it("opens once, a moment after launch, for an account that never answered", async () => {
    await render();
    expect(sheet.present).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the member has answered", { ...UNANSWERED, answer: "no" }],
    ["the server has no AI", null],
  ])("stays shut when %s", async (_why, consent) => {
    state.consent = consent;
    await render();
    expect(sheet.present).not.toHaveBeenCalled();
  });

  it("sits out a launch the first-run tour is due on", async () => {
    state.tourDue = true;
    await render();
    expect(sheet.present).not.toHaveBeenCalled();
  });

  it("waits for What's new to close first", async () => {
    requestStartupSheet("whats-new", () => {});
    await render();
    expect(sheet.present).not.toHaveBeenCalled();
    act(() => releaseStartupSheet("whats-new"));
    expect(sheet.present).toHaveBeenCalledTimes(1);
  });
});
