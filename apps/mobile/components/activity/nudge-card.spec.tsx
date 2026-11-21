/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityNudge } from "@repo/hooks";
import {
  currentItemMenu,
  dismissItemMenu,
  pickItemMenuAction,
} from "@/components/item-actions-menu";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { NudgeCard } from "./nudge-card";

/** The card at the top of the phone's Activity (#5464). */
const EVENT: ActivityNudge = {
  id: "nudge-1",
  kind: "event_soon",
  subject_key: "event-1",
  headline: "Chapter Meeting",
  meta: "Tonight 7:00 PM · Chapter House · Required",
  urgent: true,
  chip: "Tonight",
  action: "Open event",
  target_type: "event",
  target_id: "event-1",
  channel_id: null,
  task_id: null,
  line: null,
  start_here: null,
  seen: false,
};
const MENTION: ActivityNudge = {
  ...EVENT,
  id: null,
  kind: "mention_unread",
  subject_key: "ch:m",
  headline: "#exec",
  meta: "2 mentions",
  chip: "2",
  action: "Open",
  target_type: "channel",
  target_id: "ch",
};

const handlers = {
  onOpen: vi.fn(),
  onAsk: vi.fn(),
  onDismiss: vi.fn(),
  onTurnOff: vi.fn(),
  onSeen: vi.fn(),
};

function render(
  card: ActivityNudge = EVENT,
  tray: ActivityNudge[] = [],
  canAsk = true,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NudgeCard card={card} tray={tray} canAsk={canAsk} {...handlers} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const press = (tree: ReactTestRenderer, testID: string) =>
  act(() => {
    tree.root.findByProps({ testID }).props.onPress();
  });

afterEach(() => {
  dismissItemMenu();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NudgeCard", () => {
  it("shows the thing, its time and its button, and no sentence when plain", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Chapter Meeting");
    expect(text).toContain("Tonight 7:00 PM · Chapter House · Required");
    expect(text).toContain("Open event");
    expect(
      tree.root.findAllByProps({ testID: "activity-nudge-line" }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: "activity-nudge-tile-event_soon" })
        .length,
    ).toBeGreaterThan(0);
    expect(handlers.onSeen).toHaveBeenCalledWith("nudge-1");
  });

  it("draws AI's sentence on Frapp's rule when there is one", () => {
    const tree = render({ ...EVENT, line: "Being there counts for 5 points." });
    expect(screenText(tree)).toContain("Being there counts for 5 points.");
  });

  it("opens what it names, and offers Ask only with Ask", () => {
    const tree = render();
    press(tree, "activity-nudge-open");
    expect(handlers.onOpen).toHaveBeenCalledWith(EVENT);
    press(tree, "activity-nudge-ask");
    expect(handlers.onAsk).toHaveBeenCalledWith(EVENT);
    expect(
      render(EVENT, [], false).root.findAllByProps({
        testID: "activity-nudge-ask",
      }),
    ).toHaveLength(0);
  });

  it("swaps a tray item into the card in place", () => {
    const tree = render(EVENT, [MENTION]);
    press(tree, "activity-nudge-chip-mention_unread");
    const text = screenText(tree);
    expect(text).toContain("#exec");
    expect(text).toContain("2 mentions");
    // The event moved down into the tray.
    expect(
      tree.root.findAllByProps({ testID: "activity-nudge-chip-event_soon" })
        .length,
    ).toBeGreaterThan(0);
    press(tree, "activity-nudge-open");
    expect(handlers.onOpen).toHaveBeenCalledWith(MENTION);
  });

  it("closes a word of thanks with its one button, and no Ask", () => {
    const praise = {
      ...EVENT,
      kind: "task_praise",
      target_type: "task" as const,
      action: "Thanks",
    };
    const tree = render(praise);
    expect(
      tree.root.findAllByProps({ testID: "activity-nudge-ask" }),
    ).toHaveLength(0);
    press(tree, "activity-nudge-open");
    expect(handlers.onDismiss).toHaveBeenCalledWith(praise);
  });

  it("hides what it shows, or turns the cards off, from More", () => {
    const tree = render();
    press(tree, "activity-nudge-more");
    const menu = currentItemMenu()!;
    expect(menu.title).toBe("This card");
    expect(
      menu.actions.map((action) => [action.label, !!action.destructive]),
    ).toEqual([
      ["Hide this one", false],
      ["Turn these off", true],
    ]);
    act(() => pickItemMenuAction("Hide this one"));
    expect(handlers.onDismiss).toHaveBeenCalledWith(EVENT);
    expect(handlers.onTurnOff).not.toHaveBeenCalled();
    press(tree, "activity-nudge-more");
    act(() => pickItemMenuAction("Turn these off"));
    expect(handlers.onTurnOff).toHaveBeenCalled();
  });

  it("draws a kind it does not know with a neutral glyph", () => {
    const tree = render({ ...EVENT, kind: "from_the_future" });
    expect(
      tree.root.findAllByProps({
        testID: "activity-nudge-tile-from_the_future",
      }).length,
    ).toBeGreaterThan(0);
    expect(screenText(tree)).toContain("Chapter Meeting");
  });
});
