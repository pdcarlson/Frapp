import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ChatNotificationLevel } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { MuteGlyph } from "./mute-glyph";

/**
 * Per-channel notification level, from the thread header (#1406).
 *
 * Mirrors web's `NotificationLevelPanel` (named `NotificationLevelPopover`
 * until #2142 moved it behind the channel header's `⋯` menu, which is also why
 * it no longer owns a trigger of its own): `level` is the server-resolved
 * EFFECTIVE level (never a client-side `mentions` stand-in), unknown disables
 * the control, and picking a level closes immediately so dismissal does not
 * depend on the write. Failure is reported by the caller, in the header.
 *
 * Copy matches the web options so the three schema levels do not grow a fourth
 * name on mobile.
 *
 * The trigger and the menu are separate components on purpose (#2033). The
 * trigger sits in the thread header, but the menu opens over the inverted
 * message list. Drawn as an absolute child that overflowed the trigger, the
 * menu painted over the list while React Native hit-tested the list's frame,
 * so every option tap landed on a thread row. So the screen renders
 * {@link NotificationLevelMenu} as a full-bleed overlay after everything else
 * it draws, and {@link useNotificationLevelMenu} is the state both read.
 */

export const NOTIFICATION_LEVEL_OPTIONS: {
  level: ChatNotificationLevel;
  label: string;
  description: string;
}[] = [
  {
    level: "all",
    label: "Every message",
    description: "Notify me whenever anyone posts here.",
  },
  {
    level: "mentions",
    label: "Only @mentions",
    description: "Notify me when someone addresses me.",
  },
  {
    level: "off",
    label: "Mute",
    description: "No notifications — but @mentions still reach you.",
  },
];

export function triggerAccessibilityLabel(
  level: ChatNotificationLevel | null,
): string {
  if (level === null) return "Notification level unavailable";
  if (level === "off") return "Notifications: muted. Change notification level";
  if (level === "all") {
    return "Notifications: every message. Change notification level";
  }
  return "Notifications: only @mentions. Change notification level";
}

/**
 * The level the mute control should display for `channelId`.
 *
 * `undefined` rows mean the read has not landed — that is unknown, not
 * `mentions`. A missing row for a known list is also unknown: the server
 * returns every readable channel, so an absent id is not a default.
 */
export function selectChannelNotificationLevel(
  rows: { channel_id: string; level: ChatNotificationLevel }[] | undefined,
  channelId: string | null,
): ChatNotificationLevel | null {
  if (!channelId || !rows) return null;
  return rows.find((row) => row.channel_id === channelId)?.level ?? null;
}

/**
 * What the trigger and the menu share, so the screen hands both one value
 * rather than restating the level and the write-blocked reason at each.
 */
export type NotificationLevelMenuState = {
  level: ChatNotificationLevel | null;
  /** Queueless-write reason from connection-state.md; `null` when the control may write. */
  writeBlockedReason: string | null;
  /** The control cannot write: disabled, level unknown, or writes blocked. */
  blocked: boolean;
  /** The menu is on screen. */
  visible: boolean;
  toggle: () => void;
  close: () => void;
};

export function useNotificationLevelMenu({
  level,
  disabled = false,
  writeBlockedReason = null,
}: {
  level: ChatNotificationLevel | null;
  disabled?: boolean;
  writeBlockedReason?: string | null;
}): NotificationLevelMenuState {
  const [isOpen, setIsOpen] = useState(false);

  const blocked = disabled || level === null || Boolean(writeBlockedReason);
  // Close, don't just hide (#2034). The trigger is disabled while blocked, so a
  // menu merely hidden then could not be dismissed, and it came back by itself
  // once writes unblocked: over the whole screen, taking the member's next tap.
  // Reset during render, so no frame draws it.
  if (blocked && isOpen) setIsOpen(false);
  const visible = isOpen && !blocked;

  // The overlay takes every tap on the screen while it is up, so Android's
  // back button has to close it rather than pop the navigator underneath.
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setIsOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [visible]);

  const toggle = useCallback(() => {
    if (blocked) return;
    // With the composer focused, the keyboard leaves too little of a small
    // phone for the menu: its lower rows would fall outside the overlay, where
    // Android delivers no taps, or behind the keyboard on iOS.
    if (!isOpen) Keyboard.dismiss();
    setIsOpen(!isOpen);
  }, [blocked, isOpen]);
  const close = useCallback(() => setIsOpen(false), []);

  return { level, writeBlockedReason, blocked, visible, toggle, close };
}

/**
 * The header trigger. The menu it opens is {@link NotificationLevelMenu}. A
 * second touch lands on the menu's backdrop, which covers the trigger, but the
 * trigger still toggles: an activation that bypasses hit-testing (TalkBack's,
 * when a caller leaves the trigger in Android's accessibility tree) must close
 * the menu, not re-open it.
 */
export function NotificationLevelControl({
  menu,
  onLayout,
}: {
  menu: NotificationLevelMenuState;
  /** The trigger's frame, for the caller to hang the menu under it. */
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const isMuted = menu.level === "off";
  const glyphColor = menu.blocked
    ? tokens.color.text.muted
    : tokens.color.text.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={triggerAccessibilityLabel(menu.level)}
      accessibilityHint={menu.writeBlockedReason ?? undefined}
      accessibilityState={{ disabled: menu.blocked }}
      disabled={menu.blocked}
      hitSlop={12}
      onLayout={onLayout}
      onPress={menu.toggle}
      style={({ pressed }) => [styles.trigger, pressed ? styles.pressed : null]}
    >
      <MuteGlyph color={glyphColor} active={isMuted} size={24} />
      {isMuted ? <Text style={styles.mutedLabel}>Muted</Text> : null}
    </Pressable>
  );
}

/**
 * The level picker, drawn over the whole screen while it is open.
 *
 * The caller renders this as the **last** child of the container that also
 * holds the header and the message list, so the overlay is on top in paint
 * order and in hit-testing on both platforms. The menu sits inside the
 * overlay's own bounds. It relies on neither `zIndex` nor overflow
 * hit-testing, the two things that failed before (#2033). A transparent
 * backdrop fills the rest: a tap anywhere outside the menu, the trigger
 * included, closes it and never reaches the thread. Hit-testing stops touch
 * only, so the caller also hides what the menu covers from accessibility
 * while it is visible (`accessibilityViewIsModal` below is iOS-only). The
 * overlay rules, including why this is not a React Native `Modal`:
 * `spec/ui/mobile/patterns.md` § Overlays.
 */
export function NotificationLevelMenu({
  menu,
  onChange,
  isSaving = false,
  anchor,
}: {
  menu: NotificationLevelMenuState;
  onChange: (level: ChatNotificationLevel) => void;
  isSaving?: boolean;
  /** Where the menu's top-right corner goes, in the overlay's coordinates. */
  anchor: { top: number; right: number };
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);

  // Opening hides the trigger that had a screen reader's focus, which clears
  // that focus rather than moving it, so put it on the menu. From the next
  // task, not this effect: on Android the effect runs before this commit's
  // views are mounted, and a focus event for a view that isn't there yet is
  // dropped (#2641 tracks confirming it on a device).
  useEffect(() => {
    if (!menu.visible) return;
    const timer = setTimeout(() => {
      if (titleRef.current) {
        AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [menu.visible]);

  if (!menu.visible) return null;

  return (
    <View accessibilityViewIsModal style={styles.fill}>
      <Pressable
        testID="notification-level-backdrop"
        accessible={false}
        importantForAccessibility="no"
        onPress={menu.close}
        style={styles.fill}
      />
      <View
        accessibilityRole="menu"
        style={[styles.menu, { top: anchor.top, right: anchor.right }]}
      >
        <Text ref={titleRef} style={styles.menuTitle}>
          Notify me about
        </Text>
        {NOTIFICATION_LEVEL_OPTIONS.map((option) => {
          const selected = option.level === menu.level;
          return (
            <Pressable
              key={option.level}
              accessibilityRole="button"
              accessibilityLabel={`${option.label}. ${option.description}`}
              accessibilityState={{ selected, disabled: isSaving }}
              disabled={isSaving}
              onPress={() => {
                if (!selected) onChange(option.level);
                menu.close();
              }}
              style={({ pressed }) => [
                styles.option,
                selected ? styles.optionSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  selected ? styles.optionLabelSelected : null,
                ]}
              >
                {option.label}
              </Text>
              <Text
                style={[
                  styles.optionDescription,
                  selected ? styles.optionDescriptionSelected : null,
                ]}
              >
                {option.description}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={menu.close}
          style={({ pressed }) => [
            styles.cancel,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: 44,
      minWidth: 44,
      justifyContent: "center",
    },
    mutedLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.6,
    },
    /** The overlay, and the backdrop inside it. */
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    menu: {
      position: "absolute",
      width: 280,
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.control,
    },
    menuTitle: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textTransform: "uppercase",
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    option: {
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
      gap: tokens.spacing.xs,
    },
    optionSelected: {
      backgroundColor: tint(tokens.color.gold.house, 0.18),
    },
    optionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    optionLabelSelected: {
      color: tokens.color.gold.askText,
    },
    optionDescription: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    optionDescriptionSelected: {
      color: tokens.color.gold.askText,
    },
    cancel: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    cancelLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
