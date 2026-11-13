import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useFocusEffect } from "expo-router";
import {
  FILTER_CHANNELS_LABEL,
  FILTER_CHANNELS_ON_LABEL,
  HIDE_MUTED_LABEL,
  UNREAD_ONLY_LABEL,
  type SidebarFilterChange,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { Toggle } from "@/components/toggle";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useBackToClose, useFocusOnOpen } from "@/lib/overlay";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chat home's filters behind one control (owner, 2026-11-06), the way web's
 * rail keeps them behind its Channels header (`ChannelFilters`,
 * `apps/web/components/chat/channel-list.tsx`). They used to be two chips
 * above the list, the first thing on the screen for something rarely used.
 *
 * The trigger sits on the list's first heading (before that heading's New
 * channel + for someone who has one, and at its end otherwise, #4679) and
 * shows a dot in the chapter accent while a filter is on. The screen also prints a line
 * under the heading saying so, so a shortened list never reads as a chapter
 * with fewer channels. Both filters are the member's synced preferences
 * (#2877), so the menu and web's agree.
 *
 * The menu is drawn by `ScreenShell`'s `overlay`, over the whole screen, for
 * the reasons `notification-level-control.tsx` gives (#2033): the trigger
 * sits in a scroll view, and a menu hanging off it would draw over rows that
 * still take its taps. Positions come from `measureInWindow` at the tap, so
 * the scroll offset never matters.
 */

const MENU_WIDTH = 264;

/** The filter glyph's side, and how far it sits inside its 44pt target. */
const TRIGGER_GLYPH_SIZE = 20;
const triggerGlyphInset = (tokens: SignetTokens) =>
  (tokens.touch.minimum - TRIGGER_GLYPH_SIZE) / 2;

/**
 * Where the menu opens for a trigger measured in the window: just under it,
 * its right edge under the glyph's (the glyph sits inset in its 44pt
 * target), and never off the screen's left.
 */
export function channelFilterMenuAnchor(
  tokens: SignetTokens,
  trigger: { x: number; y: number; width: number; height: number },
): { top: number; left: number } {
  return {
    top: trigger.y + trigger.height + tokens.spacing.xs,
    left: Math.max(
      tokens.spacing.sm,
      trigger.x + trigger.width - triggerGlyphInset(tokens) - MENU_WIDTH,
    ),
  };
}

export type ChannelFilterMenuState = {
  visible: boolean;
  anchor: { top: number; left: number };
  open: (anchor: { top: number; left: number }) => void;
  close: () => void;
};

export function useChannelFilterMenu(): ChannelFilterMenuState {
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const close = useCallback(() => setVisible(false), []);
  const open = useCallback((at: { top: number; left: number }) => {
    setAnchor(at);
    setVisible(true);
  }, []);
  // The overlay takes every tap while it is up, so Android back closes it
  // instead of leaving the tab.
  useBackToClose(visible, close);
  // The tab bar sits outside the overlay and still takes taps, and a push can
  // open a thread over the tab. Chat home stays mounted under either, so
  // close on blur: an open menu would otherwise hold Android back on the
  // next screen and still be open on return.
  useFocusEffect(useCallback(() => close, [close]));
  return { visible, anchor, open, close };
}

/** Lucide's `ListFilter`, the web trigger's glyph, on the 24pt grid. */
function FilterGlyph({
  color,
  size = TRIGGER_GLYPH_SIZE,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M3 6h18M7 12h10M10 18h4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ChannelFilterButton({
  menu,
  active,
  atEdge = true,
}: {
  menu: ChannelFilterMenuState;
  /** A filter is on: the dot shows and the label says so. */
  active: boolean;
  /**
   * The trigger is the last thing on its heading, so its glyph's right edge
   * sits on the gutter. False when a New channel + follows it (#4679).
   */
  atEdge?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  const ref = useRef<View>(null);

  const openUnderTrigger = () => {
    const node = ref.current;
    // No frame to measure (a renderer without layout): open at the gutter.
    if (!node?.measureInWindow) {
      return menu.open({ top: 0, left: tokens.spacing.sm });
    }
    node.measureInWindow((x, y, width, height) => {
      // The menu's right edge under the glyph's, not the 44pt target's,
      // which reaches past the gutter when the trigger is at the edge.
      // Kept on screen.
      menu.open(channelFilterMenuAnchor(tokens, { x, y, width, height }));
    });
  };

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={
        active ? FILTER_CHANNELS_ON_LABEL : FILTER_CHANNELS_LABEL
      }
      accessibilityState={{ expanded: menu.visible }}
      hitSlop={8}
      onPress={() => (menu.visible ? menu.close() : openUnderTrigger())}
      // A switch in the open menu can move the trigger: the list's first
      // heading changes when a filter empties a section, and a heading with
      // no + holds the trigger at its edge. Keep the menu under it.
      onLayout={() => {
        if (menu.visible) openUnderTrigger();
      }}
      style={({ pressed }) => [
        styles.trigger,
        atEdge ? styles.triggerAtEdge : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <FilterGlyph color={active ? brand.accent : tokens.color.text.muted} />
      {active ? (
        <View
          style={[styles.dot, { backgroundColor: brand.accent }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </Pressable>
  );
}

export function ChannelFilterMenu({
  menu,
  unreadOnly,
  hideMuted,
  onChange,
}: {
  menu: ChannelFilterMenuState;
  unreadOnly: boolean;
  hideMuted: boolean;
  /** Passes straight to `useSetSidebarFilter`, as web's filters do. */
  onChange: (change: SidebarFilterChange) => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const firstRef = useRef<React.ComponentRef<typeof Text>>(null);
  // Opening hides the trigger a screen reader was on, so move its focus here.
  useFocusOnOpen(firstRef, menu.visible);

  if (!menu.visible) return null;

  const rows: {
    key: "unreadOnly" | "hideMuted";
    label: string;
    value: boolean;
  }[] = [
    { key: "unreadOnly", label: UNREAD_ONLY_LABEL, value: unreadOnly },
    { key: "hideMuted", label: HIDE_MUTED_LABEL, value: hideMuted },
  ];

  return (
    // No title and no Cancel row (components.md § Chrome weight): a tap
    // outside, Android back and VoiceOver's escape gesture close it.
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={menu.close}
      style={styles.fill}
    >
      <Pressable
        testID="channel-filter-backdrop"
        accessible={false}
        importantForAccessibility="no"
        onPress={menu.close}
        style={styles.fill}
      />
      <View
        style={[styles.menu, { top: menu.anchor.top, left: menu.anchor.left }]}
      >
        {rows.map((row, index) => (
          <View
            key={row.key}
            style={[styles.row, index > 0 ? styles.rowDivided : null]}
          >
            <Text ref={index === 0 ? firstRef : undefined} style={styles.label}>
              {row.label}
            </Text>
            <Toggle
              value={row.value}
              accessibilityLabel={row.label}
              onValueChange={(value) =>
                onChange(
                  row.key === "unreadOnly"
                    ? { unread_only: value }
                    : { hide_muted: value },
                )
              }
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    trigger: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    // The glyph's right edge sits on the gutter, like the rows' trailing
    // badges below it.
    triggerAtEdge: {
      marginRight: -triggerGlyphInset(tokens),
    },
    pressed: { opacity: 0.6 },
    dot: {
      position: "absolute",
      top: 9,
      right: 9,
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    menu: {
      position: "absolute",
      width: MENU_WIDTH,
      paddingHorizontal: tokens.spacing.md,
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.control,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum + tokens.spacing.xs,
    },
    rowDivided: {
      borderTopWidth: 1,
      borderTopColor: tokens.color.border.hairline,
    },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
  });
}
