/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import {
  NotificationLevelControl,
  NOTIFICATION_LEVEL_OPTIONS,
  selectChannelNotificationLevel,
  triggerAccessibilityLabel,
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

function renderControl(
  props: Partial<React.ComponentProps<typeof NotificationLevelControl>> = {},
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NotificationLevelControl
          level="mentions"
          onChange={vi.fn()}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
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
  return tree.root.findAll(
    (node) => node.props.accessibilityRole === "menu",
    { deep: true },
  );
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
      byLabel(
        tree,
        "Notifications: only @mentions. Change notification level",
      ),
    );

    expect(menu(tree)).toHaveLength(1);
    expect(
      byLabel(tree, "Every message. Notify me whenever anyone posts here."),
    ).toBeTruthy();
    expect(
      byLabel(tree, "Only @mentions. Notify me when someone addresses me."),
    ).toBeTruthy();
    expect(
      byLabel(
        tree,
        "Mute. No notifications — but @mentions still reach you.",
      ),
    ).toBeTruthy();
  });

  it("writes the picked level", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: "mentions", onChange });
    press(
      byLabel(
        tree,
        "Notifications: only @mentions. Change notification level",
      ),
    );
    press(
      byLabel(
        tree,
        "Mute. No notifications — but @mentions still reach you.",
      ),
    );

    expect(onChange).toHaveBeenCalledWith("off");
  });

  it("does not write when the already-selected level is picked again", () => {
    const onChange = vi.fn();
    const tree = renderControl({ level: "off", onChange });
    press(
      byLabel(tree, "Notifications: muted. Change notification level"),
    );
    press(
      byLabel(
        tree,
        "Mute. No notifications — but @mentions still reach you.",
      ),
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
      byLabel(
        tree,
        "Notifications: only @mentions. Change notification level",
      ),
    );
    press(
      byLabel(
        tree,
        "Mute. No notifications — but @mentions still reach you.",
      ),
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
});
