/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberNudge } from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { NudgeCard } from "./nudge-card";

/** The nudge card on the phone's Activity (#4781). */
const NUDGE: MemberNudge = {
  id: "nudge-1",
  kind: "task_due_soon",
  title: "A good day to start",
  body: "The venue books up fast. A call today keeps Monday calm.",
  start_here: "Call the first venue on your list.",
  task_id: "task-1",
  task_title: "Book the formal venue",
  seen: false,
  created_at: "2026-11-13T15:00:00.000Z",
};

const handlers = {
  onOpenTask: vi.fn(),
  onAsk: vi.fn(),
  onDismiss: vi.fn(),
  onTurnOff: vi.fn(),
  onSeen: vi.fn(),
};

function render(nudge: MemberNudge = NUDGE, canAsk = true): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NudgeCard nudge={nudge} canAsk={canAsk} {...handlers} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const press = (tree: ReactTestRenderer, testID: string) =>
  act(() => {
    tree.root.findByProps({ testID }).props.onPress();
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NudgeCard", () => {
  it("shows the words, the starting point and both ways in", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("From Frapp");
    expect(text).toContain("A good day to start");
    expect(text).toContain("A place to start");
    expect(text).toContain("Call the first venue on your list.");
    press(tree, "activity-nudge-open");
    expect(handlers.onOpenTask).toHaveBeenCalledTimes(1);
    press(tree, "activity-nudge-ask");
    expect(handlers.onAsk).toHaveBeenCalledTimes(1);
  });

  it("says nothing about how it was made", () => {
    const text = screenText(render());
    expect(text).not.toMatch(/\bAI\b|generated|model/i);
  });

  it("records that it was seen, once", () => {
    const tree = render();
    expect(handlers.onSeen).toHaveBeenCalledTimes(1);
    act(() => {
      tree.update(
        <FrappThemeProvider>
          <NudgeCard nudge={{ ...NUDGE, seen: true }} canAsk {...handlers} />
        </FrappThemeProvider>,
      );
    });
    expect(handlers.onSeen).toHaveBeenCalledTimes(1);
  });

  it("offers no Ask to a member without it", () => {
    const tree = render(NUDGE, false);
    expect(tree.root.findAllByProps({ testID: "activity-nudge-ask" })).toEqual(
      [],
    );
  });

  it("leaves out the starting point when the card has none", () => {
    const text = screenText(render({ ...NUDGE, start_here: null }));
    expect(text).not.toContain("A place to start");
  });

  it("gives a word of thanks one button and nothing to do", () => {
    const tree = render({
      ...NUDGE,
      kind: "task_praise",
      title: "That one landed",
      start_here: null,
    });
    expect(tree.root.findAllByProps({ testID: "activity-nudge-open" })).toEqual(
      [],
    );
    expect(tree.root.findAllByProps({ testID: "activity-nudge-more" })).toEqual(
      [],
    );
    press(tree, "activity-nudge-thanks");
    expect(handlers.onDismiss).toHaveBeenCalledWith("thanks");
  });

  it("offers Not now, fewer and off under More", () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const tree = render();
    press(tree, "activity-nudge-more");
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual([
      "Not now",
      "Show fewer of these",
      "Turn these off",
      "Cancel",
    ]);
    buttons[0]?.onPress?.();
    expect(handlers.onDismiss).toHaveBeenCalledWith("not_now");
    buttons[1]?.onPress?.();
    expect(handlers.onDismiss).toHaveBeenCalledWith("fewer");
    buttons[2]?.onPress?.();
    expect(handlers.onTurnOff).toHaveBeenCalledTimes(1);
  });
});
