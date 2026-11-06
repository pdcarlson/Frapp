import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CHANNEL_NOTIFICATIONS_LABEL,
  DELETE_CHANNEL_LABEL,
  HIDE_CONVERSATION_LABEL,
  MARK_AS_READ_LABEL,
  PIN_TO_TOP_LABEL,
  UNPIN_FROM_TOP_LABEL,
  type ChannelRowActionGroups,
  type ChannelRowActionKey,
  type ChatNotificationLevel,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { ChevronGlyph } from "@/components/chat/viewer-glyphs";
import { useFocusOnOpen } from "@/lib/overlay";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { NOTIFICATION_LEVEL_OPTIONS } from "./notification-level-control";

/** The level's word on the Notifications row, as web's menu shows it. */
export const LEVEL_DETAIL: Record<ChatNotificationLevel, string> = {
  all: "All",
  mentions: "Mentions",
  off: "Muted",
};

export interface ChannelActionsMenuTarget {
  channelId: string;
  /** The row's title, as the list shows it. */
  name: string;
  /** Where the press landed, in window coordinates; the menu opens beside it. */
  pageY: number;
  pinned: boolean;
  /** The effective level, or `undefined` while the levels are unknown. */
  level: ChatNotificationLevel | undefined;
  /** From `channelRowActions` in `@repo/hooks`, the rule web's menu reads too. */
  actions: ChannelRowActionGroups;
}

/** The menu's width, and the gap it keeps from the press and the screen edge. */
const MENU_WIDTH = 260;
const EDGE = 16;
const GAP = 12;

/**
 * A channel row's long-press menu on s04 (owner, 2026-11-06): the actions web
 * offers on a right-click, in our own glass menu rather than the system alert
 * the list used to open. A firm tick marks the press (`pressHaptic`), the way
 * a long press feels anywhere else on the phone.
 *
 * Which rows show is `channelRowActions`' call, scoped to the member's
 * permissions: Delete channel only with `channels:manage`. Notifications swaps
 * the menu for the three levels in place, a couple of taps away rather than
 * all on one screen (owner rule, 2026-11-06).
 *
 * No title bar and no Cancel row (components.md § Chrome weight): a quiet
 * caption names the channel, and a tap outside, Android back and VoiceOver's
 * escape gesture close it. A pick closes it too.
 */
export function ChannelActionsMenu({
  target,
  onClose,
  onAction,
  onSetLevel,
}: {
  target: ChannelActionsMenuTarget | null;
  onClose: () => void;
  /** Runs one action; the menu has already asked to close. */
  onAction: (
    key: ChannelRowActionKey,
    target: ChannelActionsMenuTarget,
  ) => void;
  onSetLevel: (channelId: string, level: ChatNotificationLevel) => void;
}) {
  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {target ? (
        <MenuBody
          // A fresh body per channel, so the levels view never carries over.
          key={target.channelId}
          target={target}
          onClose={onClose}
          onAction={onAction}
          onSetLevel={onSetLevel}
        />
      ) : null}
    </Modal>
  );
}

function MenuBody({
  target,
  onClose,
  onAction,
  onSetLevel,
}: {
  target: ChannelActionsMenuTarget;
  onClose: () => void;
  onAction: (
    key: ChannelRowActionKey,
    target: ChannelActionsMenuTarget,
  ) => void;
  onSetLevel: (channelId: string, level: ChatNotificationLevel) => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<"menu" | "levels">("menu");
  const [menuHeight, setMenuHeight] = useState<number | null>(null);
  const titleRef = useRef<React.ComponentRef<typeof Text>>(null);
  useFocusOnOpen(titleRef, true);

  // Below the press when it fits, above it when it doesn't, and never past
  // the safe area either way.
  const top = (() => {
    if (menuHeight === null) return target.pageY + GAP;
    const floor = height - insets.bottom - EDGE - menuHeight;
    const below = target.pageY + GAP;
    if (below <= floor) return below;
    return Math.max(insets.top + EDGE, target.pageY - GAP - menuHeight);
  })();

  const run = (key: ChannelRowActionKey) => {
    if (key === "notifications") {
      setView("levels");
      return;
    }
    onClose();
    onAction(key, target);
  };

  const label = (key: ChannelRowActionKey): string => {
    switch (key) {
      case "mark-read":
        return MARK_AS_READ_LABEL;
      case "toggle-pin":
        return target.pinned ? UNPIN_FROM_TOP_LABEL : PIN_TO_TOP_LABEL;
      case "notifications":
        return CHANNEL_NOTIFICATIONS_LABEL;
      case "hide":
        return HIDE_CONVERSATION_LABEL;
      case "delete":
        return DELETE_CHANNEL_LABEL;
      default:
        // Copy link and Edit channel are web's; mobile's surface leaves them
        // out of `channelRowActions`, so they never reach here.
        return key;
    }
  };

  const rows: { key: ChannelRowActionKey; divided: boolean }[] = [
    ...target.actions.member.map((key, i) => ({ key, divided: i > 0 })),
    // The officer's rows sit under a thicker break, so Delete is never the
    // row right under the thumb that pressed.
    ...target.actions.officer.map((key) => ({ key, divided: true })),
  ];

  return (
    <View
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          testID="channel-actions-backdrop"
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.scrim]}
        />
      </Animated.View>
      <Animated.View
        entering={reduceMotion ? FadeIn.duration(120) : popIn}
        onLayout={(event) => setMenuHeight(event.nativeEvent.layout.height)}
        style={[styles.anchor, { top, opacity: menuHeight === null ? 0 : 1 }]}
      >
        <GlassSurface style={styles.menu}>
          {view === "menu" ? (
            <View accessibilityRole="menu">
              <Text ref={titleRef} numberOfLines={1} style={styles.caption}>
                {target.name}
              </Text>
              {rows.map(({ key, divided }, index) => {
                const destructive = key === "delete";
                const firstOfficer =
                  index === target.actions.member.length && index > 0;
                const detail =
                  key === "notifications" && target.level
                    ? LEVEL_DETAIL[target.level]
                    : null;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={
                      detail ? `${label(key)}, ${detail}` : label(key)
                    }
                    onPress={() => run(key)}
                    style={({ pressed }) => [
                      styles.row,
                      divided ? styles.divided : null,
                      firstOfficer ? styles.officerBreak : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rowLabel,
                        destructive ? styles.destructive : null,
                      ]}
                    >
                      {label(key)}
                    </Text>
                    {key === "notifications" ? (
                      <View style={styles.trailing}>
                        {detail ? (
                          <Text style={styles.detail}>{detail}</Text>
                        ) : null}
                        <ChevronGlyph
                          direction="right"
                          color={tokens.color.text.mutedForeground}
                        />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View accessibilityRole="menu">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Back to ${target.name}`}
                onPress={() => setView("menu")}
                style={({ pressed }) => [
                  styles.backRow,
                  pressed ? styles.pressed : null,
                ]}
              >
                <ChevronGlyph
                  direction="left"
                  color={tokens.color.text.mutedForeground}
                />
                <Text style={styles.backLabel}>
                  {CHANNEL_NOTIFICATIONS_LABEL}
                </Text>
              </Pressable>
              {NOTIFICATION_LEVEL_OPTIONS.map((option) => {
                const selected = option.level === target.level;
                return (
                  <Pressable
                    key={option.level}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`${option.label}. ${option.description}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      onClose();
                      if (!selected) onSetLevel(target.channelId, option.level);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      styles.divided,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.rowLabel}>{option.label}</Text>
                    <View
                      style={styles.check}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {selected ? (
                        <CheckGlyph color={brand.accent} size={16} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

/** The menu's entrance: a small lift out of the pressed row, to full size. */
function popIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: {
      opacity: withTiming(1, { duration: 140 }),
      transform: [{ scale: withTiming(1, { duration: 180 }) }],
    },
  };
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    scrim: { backgroundColor: "rgba(0,0,0,0.40)" },
    anchor: {
      position: "absolute",
      left: EDGE,
      width: MENU_WIDTH,
    },
    // The quick-actions panel's glass, at a menu's radius.
    menu: { borderRadius: 22 },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    row: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    // Hairlines between rows, never under the last: with no Cancel row, a
    // closing rule would underline the menu's own edge.
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    officerBreak: {
      borderTopWidth: 6,
      borderTopColor: "rgba(0,0,0,0.18)",
    },
    pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      flex: 1,
      color: tokens.color.text.foreground,
    },
    destructive: { color: tokens.color.semantic.destructiveText },
    trailing: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    backRow: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      paddingHorizontal: tokens.spacing.md,
    },
    backLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    check: { width: 16, alignItems: "center" },
  });
}
