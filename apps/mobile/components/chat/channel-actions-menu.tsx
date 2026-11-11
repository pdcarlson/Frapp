import { useRef, useState } from "react";
import {
  Modal,
  Platform,
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
  CHANNEL_LEVEL_DETAIL,
  CHANNEL_NOTIFICATIONS_LABEL,
  DELETE_CHANNEL_LABEL,
  HIDE_CONVERSATION_LABEL,
  MARK_AS_READ_LABEL,
  PIN_TO_TOP_LABEL,
  UNPIN_FROM_TOP_LABEL,
  type ChannelRowActionGroups,
  type ChannelRowActionKey,
  type ChatNotificationLevel,
  useChapterChatBackground,
  useChatBackground,
} from "@repo/hooks";
import {
  CHAT_BACKGROUND_LABELS,
  type ChatBackgroundKey,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { CheckGlyph } from "@/components/tasks/task-glyphs";
import { ChevronGlyph } from "@/components/chat/viewer-glyphs";
import { useFocusOnOpen } from "@/lib/overlay";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { NOTIFICATION_LEVEL_OPTIONS } from "./notification-level-control";
import { ChatBackgroundSwatches } from "./chat-background-picker";
import {
  ALWAYS_FORMAL_LABEL,
  CHANNEL_DISPLAY_LOCKED_NOTE,
  channelDensityChoices,
  channelDensityDetail,
} from "@repo/chat-core/density";
import {
  setChannelDensity,
  useChannelDensityOverride,
  useChannelDisplayLocked,
  useChatDensity,
} from "@/lib/chat/chat-density";

/**
 * The menu's own rows: this channel's display on this phone (#3787), and its
 * background for everyone (#4031).
 */
type MenuRowKey = ChannelRowActionKey | "display" | "background";

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
  /**
   * The viewer created the channel or holds `channels:manage`
   * (`canSetChannelDisplayLock`), so the Display view offers Always formal
   * (#3787).
   */
  canSetDisplayLock?: boolean;
  /**
   * `canSetChannelBackground` from `@repo/hooks` said yes for this viewer and
   * channel, so the menu offers Background (#4031).
   */
  canSetBackground?: boolean;
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
  onSetDisplayLock,
  onSetBackground,
  writeBlockedReason,
}: {
  target: ChannelActionsMenuTarget | null;
  onClose: () => void;
  /** Runs one action; the menu has already asked to close. */
  onAction: (
    key: ChannelRowActionKey,
    target: ChannelActionsMenuTarget,
  ) => void;
  onSetLevel: (channelId: string, level: ChatNotificationLevel) => void;
  /** Sets or clears Always formal (#3787); offered only with `canSetDisplayLock`. */
  onSetDisplayLock?: (channelId: string, locked: boolean) => void;
  /**
   * Sets a channel's background, or with null follows the chapter default
   * (#4031); offered only with `canSetBackground`. Runs once the menu has
   * finished closing, because `photo` opens the library, and presenting it
   * while this modal animates out can leave it drawing nothing.
   */
  onSetBackground?: (channelId: string, pick: ChatBackgroundKey | null) => void;
  /**
   * Why a queueless write is blocked right now (`useConnection`), or `null`.
   * A level pick is one, so Notifications locks with it, as the thread
   * header's level control does.
   */
  writeBlockedReason: string | null;
}) {
  // A background pick waits here until the modal is gone (see
  // `onSetBackground`). iOS reports that through `onDismiss`; Android's
  // library is its own activity, so it can run on the close.
  const afterClose = useRef<(() => void) | null>(null);
  const runAfterClose = () => {
    const run = afterClose.current;
    afterClose.current = null;
    run?.();
  };
  const closeThen = (run: () => void) => {
    afterClose.current = run;
    onClose();
    if (Platform.OS !== "ios") runAfterClose();
  };

  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      onDismiss={runAfterClose}
    >
      {target ? (
        <MenuBody
          // A fresh body per channel, so the levels view never carries over.
          key={target.channelId}
          target={target}
          onClose={onClose}
          onAction={onAction}
          onSetLevel={onSetLevel}
          onSetDisplayLock={onSetDisplayLock}
          onSetBackground={
            onSetBackground
              ? (channelId, pick) =>
                  closeThen(() => onSetBackground(channelId, pick))
              : undefined
          }
          writeBlockedReason={writeBlockedReason}
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
  onSetDisplayLock,
  onSetBackground,
  writeBlockedReason,
}: {
  target: ChannelActionsMenuTarget;
  onClose: () => void;
  onAction: (
    key: ChannelRowActionKey,
    target: ChannelActionsMenuTarget,
  ) => void;
  onSetLevel: (channelId: string, level: ChatNotificationLevel) => void;
  onSetDisplayLock?: (channelId: string, locked: boolean) => void;
  /** Closes the menu itself, then sets (see `ChannelActionsMenu`). */
  onSetBackground?: (channelId: string, pick: ChatBackgroundKey | null) => void;
  writeBlockedReason: string | null;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<
    "menu" | "levels" | "display" | "background"
  >("menu");
  const showBackground =
    target.canSetBackground === true && onSetBackground !== undefined;
  // Only read for someone who can change it: the row's detail and the
  // view's selected swatch.
  const background = useChatBackground(
    showBackground ? target.channelId : null,
  );
  const channelBackground: ChatBackgroundKey | null =
    background.data?.source === "channel" ? background.data.background : null;
  const defaultDensity = useChatDensity();
  const densityOverride = useChannelDensityOverride(target.channelId);
  const displayLocked = useChannelDisplayLocked(target.channelId);
  const showLockToggle =
    target.canSetDisplayLock === true && onSetDisplayLock !== undefined;
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

  // A pick while the level is unknown would overwrite a level the member
  // can't see, and one offline would only fail, so both lock the row.
  const levelsBlockedReason = writeBlockedReason
    ? writeBlockedReason
    : target.level
      ? null
      : "Loading your notification settings.";

  const run = (key: MenuRowKey) => {
    if (key === "display" || key === "background") {
      setView(key);
      return;
    }
    if (key === "notifications") {
      if (levelsBlockedReason) return;
      setView("levels");
      return;
    }
    onClose();
    onAction(key, target);
  };

  const label = (key: MenuRowKey): string => {
    switch (key) {
      case "display":
        return "Display";
      case "background":
        return "Background";
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

  const rows: { key: MenuRowKey; divided: boolean }[] = [
    ...target.actions.member.map((key, i) => ({ key, divided: i > 0 })),
    // Every member's, and local: it writes nothing to the server.
    { key: "display", divided: target.actions.member.length > 0 },
    // Beside Display, as on web's channel menu; it changes the channel for
    // everyone, so only a manager sees it.
    ...(showBackground
      ? [{ key: "background" as const, divided: true }]
      : []),
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
                  index ===
                  target.actions.member.length + 1 + (showBackground ? 1 : 0);
                // Background writes to the server too, so offline locks it with
                // the same reason (a photo would otherwise be picked and
                // shrunk only to fail at the upload).
                const blockedReason =
                  key === "notifications"
                    ? levelsBlockedReason
                    : key === "background"
                      ? writeBlockedReason
                      : null;
                const disabled = blockedReason !== null;
                const detail =
                  key === "display"
                    ? channelDensityDetail(densityOverride, displayLocked)
                    : key === "background"
                      ? background.data
                        ? channelBackground
                          ? CHAT_BACKGROUND_LABELS[channelBackground]
                          : "Chapter default"
                        : null
                      : key === "notifications" && target.level
                      ? CHANNEL_LEVEL_DETAIL[target.level]
                      : null;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={
                      detail ? `${label(key)}, ${detail}` : label(key)
                    }
                    accessibilityHint={blockedReason ?? undefined}
                    accessibilityState={disabled ? { disabled } : undefined}
                    disabled={disabled}
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
                        disabled ? styles.disabledLabel : null,
                      ]}
                    >
                      {label(key)}
                    </Text>
                    {key === "notifications" ||
                    key === "display" ||
                    key === "background" ? (
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
          ) : view === "background" ? (
            <BackgroundView
              name={target.name}
              value={background.data ? channelBackground : undefined}
              loaded={background.data !== undefined || background.isError}
              onBack={() => setView("menu")}
              onPick={(pick) => {
                // Re-picking a built-in already in place writes nothing; a
                // photo always opens the library, to replace it. Only when the
                // setting was actually read: after a failed read nothing is
                // known, so every pick writes.
                if (
                  background.data !== undefined &&
                  pick !== "photo" &&
                  pick === channelBackground
                ) {
                  onClose();
                  return;
                }
                onSetBackground?.(target.channelId, pick);
              }}
            />
          ) : view === "display" ? (
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
                <Text style={styles.backLabel}>Display</Text>
              </Pressable>
              {showLockToggle ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={ALWAYS_FORMAL_LABEL}
                  accessibilityState={{ checked: displayLocked }}
                  onPress={() => {
                    onClose();
                    onSetDisplayLock?.(target.channelId, !displayLocked);
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    styles.divided,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.rowLabel}>{ALWAYS_FORMAL_LABEL}</Text>
                  <View
                    style={styles.check}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    {displayLocked ? (
                      <CheckGlyph color={brand.accent} size={16} />
                    ) : null}
                  </View>
                </Pressable>
              ) : null}
              {displayLocked ? (
                <Text style={[styles.caption, styles.divided]}>
                  {CHANNEL_DISPLAY_LOCKED_NOTE}
                </Text>
              ) : null}
              {channelDensityChoices(defaultDensity).map((choice) => {
                // Locked, the member's own pick doesn't apply here, so none
                // is marked and none can be picked (#3787).
                const selected = !displayLocked && choice.value === densityOverride;
                return (
                  <Pressable
                    key={choice.value ?? "default"}
                    accessibilityRole="menuitem"
                    accessibilityLabel={choice.label}
                    accessibilityState={{ selected, disabled: displayLocked }}
                    disabled={displayLocked}
                    onPress={() => {
                      onClose();
                      if (!selected) {
                        setChannelDensity(target.channelId, choice.value);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      styles.divided,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.rowLabel,
                        displayLocked ? styles.disabledLabel : null,
                      ]}
                    >
                      {choice.label}
                    </Text>
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

/**
 * The Background view (#4031): the swatches web's channel menu shows, with
 * "Chapter default" first. The chapter default is read here, only once the
 * view opens, for that swatch's preview.
 */
function BackgroundView({
  name,
  value,
  loaded,
  onBack,
  onPick,
}: {
  name: string;
  /** Undefined when the channel's setting couldn't be read. */
  value: ChatBackgroundKey | null | undefined;
  /** The channel's setting has been read; until then nothing is marked or pickable. */
  loaded: boolean;
  onBack: () => void;
  onPick: (pick: ChatBackgroundKey | null) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const chapterDefault = useChapterChatBackground();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to ${name}`}
        onPress={onBack}
        style={({ pressed }) => [styles.backRow, pressed ? styles.pressed : null]}
      >
        <ChevronGlyph
          direction="left"
          color={tokens.color.text.mutedForeground}
        />
        <Text style={styles.backLabel}>Background</Text>
      </Pressable>
      <View style={[styles.divided, styles.swatches]}>
        <ChatBackgroundSwatches
          value={value}
          allowInherit
          inheritPreview={chapterDefault.data?.background}
          disabled={!loaded}
          onPick={onPick}
        />
      </View>
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
    disabledLabel: { color: tokens.color.text.mutedForeground },
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
    swatches: {
      paddingHorizontal: tokens.spacing.sm,
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
    },
  });
}
