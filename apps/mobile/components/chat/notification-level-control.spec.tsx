/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo, BackHandler, Keyboard } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { ChatNotificationLevel } from "@repo/hooks";
import {
  NotificationLevelControl,
  NotificationLevelMenu,
  NOTIFICATION_LEVEL_OPTIONS,
  selectChannelNotificationLevel,
  triggerAccessibilityLabel,
  useNotificationLevelMenu,
} from "./notification-level-control";

/**
 * The mute control in the mobile thread header (#1406).
 *
 * Mirrors web's `notification-level-popover.spec.tsx`: the muted state is
 * announced rather than only drawn, re-picking the current level does not
 * write, the three options stay the schema's three levels, unknown disables
 * the trigger instead of standing in `mentions`, and picking a level closes
 * immediately so dismissal does not wait on the write.
 */

type ControlProps = {
  level: ChatNotificationLevel | null;
  onChange: (level: ChatNotificationLevel) => void;
  disabled?: boolean;
  isSaving?: boolean;
  writeBlockedReason?: string | null;
};

const ANCHOR = { top: 57, right: 16 };

// `react-native` is mocked with string host components (vitest.setup.ts), so
// `View` here is the same "View" host the components render.
const View = "View" as unknown as React.ComponentType<{
  testID?: string;
  children?: React.ReactNode;
}>;

const onTriggerLayout = vi.fn();

/**
 * The trigger and the menu as `app/(tabs)/chat-thread.tsx` lays them out: the
 * trigger inside a header, the menu a later sibling, one shared
 * `useNotificationLevelMenu`. The thread's accessibility wrapper is not
 * mirrored here; `lib/chat/thread-mute-menu-wiring.spec.ts` pins it.
 */
function Thread({
  level,
  onChange,
  disabled,
  isSaving,
  writeBlockedReason,
}: ControlProps) {
  const menu = useNotificationLevelMenu({
    level,
    disabled,
    writeBlockedReason,
  });
  return (
    <>
      <View testID="header">
        <NotificationLevelControl menu={menu} onLayout={onTriggerLayout} />
      </View>
      <NotificationLevelMenu
        menu={menu}
        onChange={onChange}
        isSaving={isSaving}
        anchor={ANCHOR}
      />
    </>
  );
}

function renderControl(props: Partial<ControlProps> = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Thread level="mentions" onChange={vi.fn()} {...props} />
      </FrappThemeProvider>,
      // Host refs resolve to a stand-in that remembers its element, so a spec
      // can tell which node the menu moved focus to.
      { createNodeMock: (element) => ({ element }) },
    );
  });
  return tree;
}

function rerender(tree: ReactTestRenderer, props: ControlProps) {
  act(() => {
    tree.update(
      <FrappThemeProvider>
        <Thread {...props} />
      </FrappThemeProvider>,
    );
  });
}

/** Style arrays flattened the way React Native would, for the mocked StyleSheet. */
function flatStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flatStyle));
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

function press(node: { props: { onPress?: (event?: unknown) => void } }) {
  act(() => {
    node.props.onPress?.();
  });
}

function byLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findByProps({ accessibilityLabel: label });
}

function menu(tree: ReactTestRenderer) {
  return tree.root.findAll((node) => node.props.accessibilityRole === "menu", {
    deep: true,
  });
}

describe("NOTIFICATION_LEVEL_OPTIONS", () => {
  it("is exactly the three levels the schema allows", () => {
    // `chat_notification_preferences.level` is CHECK-constrained to these
    // three; a fourth option here would 500 on write rather than fail visibly.
    expect(NOTIFICATION_LEVEL_OPTIONS.map((option) => option.level)).toEqual([
      "all",
      "mentions",
      "off",
    ]);
  });
});

describe("triggerAccessibilityLabel", () => {
  it("announces muted, every-message, and mentions — and unknown as unavailable", () => {
    expect(triggerAccessibilityLabel("off")).toMatch(/notifications: muted/i);
    expect(triggerAccessibilityLabel("all")).toMatch(
      /notifications: every message/i,
    );
    expect(triggerAccessibilityLabel("mentions")).toMatch(
      /notifications: only @mentions/i,
    );
    expect(triggerAccessibilityLabel(null)).toMatch(
      /notification level unavailable/i,
    );
  });
});

describe("selectChannelNotificationLevel", () => {
  const rows = [
    { channel_id: "chan-all", level: "all" as const },
    { channel_id: "chan-off", level: "off" as const },
  ];

  it("returns null when the read has not landed", () => {
    // `undefined` rows are unknown, not `mentions` — on `#announcements`
    // (`all`) or `#chapter-audit` (`off`) that stand-in states the wrong level.
    expect(selectChannelNotificationLevel(undefined, "chan-all")).toBeNull();
  });

  it("returns null when there is no channel, or the id is missing from a known list", () => {
    expect(selectChannelNotificationLevel(rows, null)).toBeNull();
    expect(selectChannelNotificationLevel(rows, "chan-missing")).toBeNull();
  });

  it("returns the server-resolved effective level for a known channel", () => {
    expect(selectChannelNotificationLevel(rows, "chan-all")).toBe("all");
    expect(selectChannelNotificationLevel(rows, "chan-off")).toBe("off");
  });
});

describe("NotificationLevelControl", () => {
  it("announces the muted state to assistive tech, not just visually", () => {
    const tree = renderControl({ level: "off" });
    const trigger = byLabel(
      tree,
      "Notifications: muted. Change notification level",
    );
    expect(trigger.props.accessibilityRole).toBe("button");
    expect(trigger.props.disabled).toBe(false);
  });

  it("names the current level when not muted", () => {
    const tree = renderControl({ level: "all" });
    expect(
      byLabel(tree, "Notifications: every message. Change notification level")
        .props.accessibilityRole,
    ).toBe("button");
  });

  it("offers exactly the three levels the schema allows", () => {
    const tree = renderControl({ level: "mentions" });
    press(
      byLabel(tree, "Notifications: only @mentions. Change notification level"),
    );

    expect(menu(tree)).toHaveLength(1);
    expect(
      byLabel(tree, "Every message. Notify me whenever anyone posts here."),
    ).toBeTruthy();
    expect(
      byLabel(tree, "Only @mentions. Notify me when someone addresses me."),
    ).toBeTruthy();
    expect(
      byLabel(tree, "Mute. No notifications — but @mentions still reach you."),
    ).toBeTruthy();
  });

  it("writes the picked level", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: "mentions", onChange });
    press(
      byLabel(tree, "Notifications: only @mentions. Change notification level"),
    );
    press(
      byLabel(tree, "Mute. No notifications — but @mentions still reach you."),
    );

    expect(onChange).toHaveBeenCalledWith("off");
  });

  it("does not write when the already-selected level is picked again", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: "off", onChange });
    press(byLabel(tree, "Notifications: muted. Change notification level"));
    press(
      byLabel(tree, "Mute. No notifications — but @mentions still reach you."),
    );

    // A no-op round trip would still bump `updated_at` for nothing.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is disabled when the caller says so", () => {
    const tree = renderControl({ level: "mentions", disabled: true });
    const trigger = byLabel(
      tree,
      "Notifications: only @mentions. Change notification level",
    );
    expect(trigger.props.disabled).toBe(true);
    press(trigger);
    expect(menu(tree)).toHaveLength(0);
  });

  it("closes as soon as a level is picked", () => {
    const onChange = vi.fn();
    const tree = renderControl({
      level: "mentions",
      onChange,
      isSaving: false,
    });
    press(
      byLabel(tree, "Notifications: only @mentions. Change notification level"),
    );
    press(
      byLabel(tree, "Mute. No notifications — but @mentions still reach you."),
    );

    expect(onChange).toHaveBeenCalledWith("off");
    expect(menu(tree)).toHaveLength(0);
  });

  it("reports no level, and refuses interaction, when the level is unknown", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: null, onChange });
    const trigger = byLabel(tree, "Notification level unavailable");
    expect(trigger.props.disabled).toBe(true);
    expect(trigger.props.accessibilityState).toEqual({ disabled: true });

    press(trigger);
    expect(menu(tree)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays disabled while the app is OFFLINE", () => {
    const onChange = vi.fn();
    const tree = renderControl({
      level: "mentions",
      onChange,
      writeBlockedReason: "Reconnect to make changes.",
    });
    const trigger = byLabel(
      tree,
      "Notifications: only @mentions. Change notification level",
    );
    expect(trigger.props.disabled).toBe(true);
    expect(trigger.props.accessibilityHint).toBe("Reconnect to make changes.");

    press(trigger);
    expect(menu(tree)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes an open menu when writes become blocked", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: "mentions", onChange });
    press(
      byLabel(tree, "Notifications: only @mentions. Change notification level"),
    );
    expect(menu(tree)).toHaveLength(1);

    act(() => {
      tree.update(
        <FrappThemeProvider>
          <Thread
            level="mentions"
            onChange={onChange}
            writeBlockedReason="Reconnect to make changes."
          />
        </FrappThemeProvider>,
      );
    });

    expect(menu(tree)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  // #2034: the menu used to be hidden rather than closed while blocked, and the
  // trigger is disabled then, so nothing could dismiss it and it came back by
  // itself on reconnect.
  it("stays closed once writes unblock, until the member opens it again", () => {
    const onChange = vi.fn();
    const trigger = "Notifications: only @mentions. Change notification level";
    const tree = renderControl({ level: "mentions", onChange });
    press(byLabel(tree, trigger));
    expect(menu(tree)).toHaveLength(1);

    rerender(tree, {
      level: "mentions",
      onChange,
      writeBlockedReason: "Reconnect to make changes.",
    });
    expect(menu(tree)).toHaveLength(0);

    rerender(tree, { level: "mentions", onChange, writeBlockedReason: null });
    expect(menu(tree)).toHaveLength(0);

    press(byLabel(tree, trigger));
    expect(menu(tree)).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays closed once an unknown level resolves again", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: "mentions", onChange });
    press(
      byLabel(tree, "Notifications: only @mentions. Change notification level"),
    );
    expect(menu(tree)).toHaveLength(1);

    rerender(tree, { level: null, onChange });
    expect(menu(tree)).toHaveLength(0);
    rerender(tree, { level: "mentions", onChange });
    expect(menu(tree)).toHaveLength(0);
  });
});

/**
 * #2033: the menu drew over the inverted thread but its taps landed on the
 * thread, because it hung off the header as an absolute child overflowing its
 * parent. Pressing an option's `onPress` directly, as the specs above do,
 * proves nothing about where a real tap lands, so these pin the structure that
 * makes the menu own its hit target.
 */
describe("NotificationLevelMenu hit target (#2033)", () => {
  const TRIGGER = "Notifications: only @mentions. Change notification level";
  const MUTE = "Mute. No notifications — but @mentions still reach you.";

  beforeEach(() => {
    vi.mocked(BackHandler.addEventListener).mockClear();
    vi.mocked(Keyboard.dismiss).mockClear();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    onTriggerLayout.mockClear();
  });

  function openMenu(onChange = vi.fn()) {
    const tree = renderControl({ level: "mentions", onChange });
    press(byLabel(tree, TRIGGER));
    expect(menu(tree)).toHaveLength(1);
    return tree;
  }

  function backdrop(tree: ReactTestRenderer) {
    return tree.root.find(
      (node) =>
        node.props.testID === "notification-level-backdrop" &&
        typeof node.type === "string",
    );
  }

  it("is not drawn inside the trigger's header", () => {
    const tree = openMenu();
    const header = tree.root.find(
      (node) => node.props.testID === "header" && typeof node.type === "string",
    );
    expect(
      header.findAll((node) => node.props.accessibilityRole === "menu"),
    ).toHaveLength(0);
  });

  it("sits inside a full-bleed overlay, anchored in the overlay's own bounds", () => {
    const tree = openMenu();
    const [menuNode] = menu(tree);
    const overlay = menuNode.parent!;

    expect(flatStyle(overlay.props.style)).toMatchObject({
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });

    // A percentage offset or a zIndex is the old overflow-and-hope shape.
    const menuStyle = flatStyle(menuNode.props.style);
    expect(menuStyle).toMatchObject({ top: ANCHOR.top, right: ANCHOR.right });
    expect(menuStyle).not.toHaveProperty("zIndex");
  });

  it("puts the backdrop under the menu, so the menu is the topmost hit target", () => {
    const tree = openMenu();
    const [menuNode] = menu(tree);
    const overlayChildren = menuNode.parent!
      .children as ReactTestRenderer["root"][];
    const hostChildren = overlayChildren.filter(
      (child) => typeof child === "object" && typeof child.type === "string",
    );

    expect(
      hostChildren.map(
        (child) => child.props.testID ?? child.props.accessibilityRole,
      ),
    ).toEqual(["notification-level-backdrop", "menu"]);
  });

  it("closes on a tap outside the menu, without writing", () => {
    const onChange = vi.fn();
    const tree = openMenu(onChange);

    press(backdrop(tree));

    expect(menu(tree)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    // The trigger works again once the menu is gone.
    press(byLabel(tree, TRIGGER));
    expect(menu(tree)).toHaveLength(1);
  });

  it("closes when the trigger is activated again past hit-testing", () => {
    const onChange = vi.fn();
    const tree = openMenu(onChange);
    // Defensive: a touch lands on the backdrop, and the thread hides the
    // trigger from screen readers while the menu is up. An activation that
    // reaches the trigger's handler anyway must close the menu, not re-open it.
    press(byLabel(tree, TRIGGER));
    expect(menu(tree)).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the backdrop out of the accessibility tree; Cancel is the spoken dismissal", () => {
    const tree = openMenu();
    const node = backdrop(tree);
    expect(node.props.accessible).toBe(false);
    expect(node.props.importantForAccessibility).toBe("no");
    expect(byLabel(tree, "Cancel").props.accessibilityRole).toBe("button");
  });

  it("closes on Android's back button instead of popping the screen, and lets go once closed", () => {
    const tree = openMenu();
    const addListener = vi.mocked(BackHandler.addEventListener);
    expect(addListener).toHaveBeenCalledWith(
      "hardwareBackPress",
      expect.any(Function),
    );
    const [, handler] = addListener.mock.calls.at(-1)!;
    const subscription = addListener.mock.results.at(-1)!.value as {
      remove: ReturnType<typeof vi.fn>;
    };

    let handled: boolean | null | undefined;
    act(() => {
      handled = (handler as () => boolean)();
    });

    expect(handled).toBe(true);
    expect(menu(tree)).toHaveLength(0);
    expect(subscription.remove).toHaveBeenCalled();
  });

  it("does not hold the back button while the menu is closed", () => {
    renderControl({ level: "mentions" });
    expect(BackHandler.addEventListener).not.toHaveBeenCalled();
  });

  it("dismisses the keyboard as it opens, so the keyboard can't cover the lower rows", () => {
    openMenu();
    expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves the keyboard alone when the trigger is blocked", () => {
    const tree = renderControl({
      level: "mentions",
      writeBlockedReason: "Reconnect to make changes.",
    });
    press(byLabel(tree, TRIGGER));
    expect(Keyboard.dismiss).not.toHaveBeenCalled();
  });

  it("reports the trigger's frame, so the caller can hang the menu under it", () => {
    const tree = renderControl({ level: "mentions" });
    expect(byLabel(tree, TRIGGER).props.onLayout).toBe(onTriggerLayout);
  });

  it("moves a screen reader's focus onto the menu title, once it is mounted", () => {
    vi.useFakeTimers();
    try {
      openMenu();
      // Not from the opening commit's effect: on Android that runs before the
      // title's view exists, and the event would be dropped.
      expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

      act(() => {
        vi.runAllTimers();
      });

      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
      const [target, eventType] = vi.mocked(
        AccessibilityInfo.sendAccessibilityEvent,
      ).mock.calls[0] as unknown as [
        { element: { props: { children?: unknown } } },
        string,
      ];
      expect(eventType).toBe("focus");
      expect(target.element.props.children).toBe("Notify me about");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the pending focus when the menu closes first", () => {
    vi.useFakeTimers();
    try {
      // Close and reopen before the first timer fires: an uncleared timer
      // would find the reopened title mounted and focus it a second time.
      const tree = openMenu();
      press(byLabel(tree, "Cancel"));
      press(byLabel(tree, TRIGGER));
      expect(menu(tree)).toHaveLength(1);

      act(() => {
        vi.runAllTimers();
      });

      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still writes the picked level from inside the overlay", () => {
    const onChange = vi.fn();
    const tree = openMenu(onChange);
    press(byLabel(tree, MUTE));
    expect(onChange).toHaveBeenCalledWith("off");
    expect(menu(tree)).toHaveLength(0);
  });
});
