import { useCallback, useRef, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ChatNotificationLevel } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useBackToClose, useFocusOnOpen } from "@/lib/overlay";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
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

  const close = useCallback(() => setIsOpen(false), []);
  // The overlay takes every tap on the screen while it is up, so Android's
  // back button has to close it rather than pop the navigator underneath.
  useBackToClose(visible, close);

  const toggle = useCallback(() => {
    if (blocked) return;
    // With the composer focused, the keyboard leaves too little of a small
    // phone for the menu: its lower rows would fall outside the overlay, where
    // Android delivers no taps, or behind the keyboard on iOS.
    if (!isOpen) Keyboard.dismiss();
    setIsOpen(!isOpen);
  }, [blocked, isOpen]);

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
      {/*
        The glyph alone (components.md § Icon-only actions). Muted already
        draws its own × over the speaker, and the label says "Muted" to a
        screen reader, so a "Muted" word beside it said the same thing twice.
      */}
      <MuteGlyph color={glyphColor} active={isMuted} size={24} />
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
 *
 * The levels are a radio group, so the current one is a control the member
 * switched on, and its checkmark is the one thing here in the chapter accent.
 * The rows themselves stay neutral, the selected one included: no accent wash,
 * the label in the foreground text, the description muted (foundations.md §6,
 * "Where the accent goes", 2026-11-05).
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
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);

  // Opening hides the trigger that had a screen reader's focus, which clears
  // that focus rather than moving it, so put it on the menu.
  useFocusOnOpen(titleRef, menu.visible);

  if (!menu.visible) return null;

  return (
    // No Cancel row (components.md § Chrome weight): a tap outside, Android
    // back (`useBackToClose`) and VoiceOver's escape gesture close it, and a
    // pick closes it too.
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={menu.close}
      style={styles.fill}
    >
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
        {NOTIFICATION_LEVEL_OPTIONS.map((option, index) => {
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
                index > 0 ? styles.optionDivided : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.optionText}>
                <Text style={styles.optionLabel}>{option.label}</Text>
                <Text style={styles.optionDescription}>
                  {option.description}
                </Text>
              </View>
              {/* A fixed slot, so the text wraps the same whichever row is
                  on. Decorative: `selected` already says it. */}
              <View
                style={styles.optionCheck}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {selected ? (
                  <CheckGlyph color={brand.accent} size={OPTION_CHECK_SIZE} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The selected level's checkmark, at the tab family's small size. */
const OPTION_CHECK_SIZE = 16;

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
    // A quiet caption in sentence case, with no rule under it: the menu's
    // name, not a boxed header.
    menuTitle: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.md,
    },
    // Hairlines between the levels only, not under the last: with no Cancel
    // row below it, a closing rule would underline the menu's own edge.
    optionDivided: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    optionText: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    optionCheck: {
      width: OPTION_CHECK_SIZE,
      alignItems: "center",
    },
    optionLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    optionDescription: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
