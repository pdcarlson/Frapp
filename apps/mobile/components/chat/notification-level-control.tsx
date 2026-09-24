import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
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

/** What the trigger and the menu share. */
export type NotificationLevelMenuState = {
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
  /** Queueless-write reason from connection-state.md; `null` when the control may write. */
  writeBlockedReason?: string | null;
}): NotificationLevelMenuState {
  const [open, setOpen] = useState(false);

  const blocked = disabled || level === null || Boolean(writeBlockedReason);
  // Hidden while blocked, but `open` survives it, so the menu comes back by
  // itself once writes unblock. That is #2034, tracked separately.
  const visible = open && !blocked;

  // The overlay takes every tap on the screen while it is up, so Android's
  // back button has to close it rather than pop the navigator underneath.
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        setOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [visible]);

  const toggle = useCallback(() => {
    if (blocked) return;
    setOpen((current) => !current);
  }, [blocked]);
  const close = useCallback(() => setOpen(false), []);

  return { blocked, visible, toggle, close };
}

/** The header trigger. The menu it opens is {@link NotificationLevelMenu}. */
export function NotificationLevelControl({
  level,
  menu,
  writeBlockedReason = null,
}: {
  level: ChatNotificationLevel | null;
  menu: NotificationLevelMenuState;
  writeBlockedReason?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const isMuted = level === "off";
  const glyphColor = menu.blocked
    ? tokens.color.text.muted
    : tokens.color.text.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={triggerAccessibilityLabel(level)}
      accessibilityHint={writeBlockedReason ?? undefined}
      accessibilityState={{ disabled: menu.blocked }}
      disabled={menu.blocked}
      hitSlop={12}
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
 * included, closes it and never reaches the thread.
 *
 * Not a React Native `Modal`: that is a separate native window, and it would
 * draw over `ClientPolicyGate`'s update prompt, which has to cover everything.
 * This overlay stays inside the gate's `pointerEvents="none"` subtree.
 */
export function NotificationLevelMenu({
  level,
  menu,
  onChange,
  isSaving = false,
  writeBlockedReason = null,
  anchor,
}: {
  level: ChatNotificationLevel | null;
  menu: NotificationLevelMenuState;
  onChange: (level: ChatNotificationLevel) => void;
  isSaving?: boolean;
  writeBlockedReason?: string | null;
  /** Where the menu's top-right corner goes, in the overlay's coordinates. */
  anchor: { top: number; right: number };
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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
        <Text style={styles.menuTitle}>Notify me about</Text>
        {NOTIFICATION_LEVEL_OPTIONS.map((option) => {
          const selected = option.level === level;
          return (
            <Pressable
              key={option.level}
              accessibilityRole="button"
              accessibilityLabel={`${option.label}. ${option.description}`}
              accessibilityState={{
                selected,
                disabled: isSaving || Boolean(writeBlockedReason),
              }}
              disabled={isSaving || Boolean(writeBlockedReason)}
              onPress={() => {
                if (writeBlockedReason) {
                  menu.close();
                  return;
                }
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
