import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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

export function NotificationLevelControl({
  level,
  onChange,
  disabled = false,
  isSaving = false,
  writeBlockedReason = null,
}: {
  level: ChatNotificationLevel | null;
  onChange: (level: ChatNotificationLevel) => void;
  disabled?: boolean;
  isSaving?: boolean;
  /** Queueless-write reason from connection-state.md; `null` when the control may write. */
  writeBlockedReason?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState(false);

  const unknown = level === null;
  const isMuted = level === "off";
  const blocked = disabled || unknown || Boolean(writeBlockedReason);
  const showMenu = open && !blocked;
  const glyphColor = blocked
    ? tokens.color.text.muted
    : tokens.color.text.foreground;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={triggerAccessibilityLabel(level)}
        accessibilityHint={writeBlockedReason ?? undefined}
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        hitSlop={12}
        onPress={() => {
          if (blocked) return;
          setOpen((current) => !current);
        }}
        style={({ pressed }) => [styles.trigger, pressed ? styles.pressed : null]}
      >
        <MuteGlyph color={glyphColor} active={isMuted} size={24} />
        {isMuted ? <Text style={styles.mutedLabel}>Muted</Text> : null}
      </Pressable>
      {showMenu ? (
        <View accessibilityRole="menu" style={styles.menu}>
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
                    setOpen(false);
                    return;
                  }
                  if (!selected) onChange(option.level);
                  setOpen(false);
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
            onPress={() => setOpen(false)}
            style={({ pressed }) => [
              styles.cancel,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
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
    menu: {
      position: "absolute",
      right: 0,
      top: "100%",
      zIndex: 2,
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
