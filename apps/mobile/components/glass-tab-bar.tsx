import { useCallback, useEffect, useState } from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/tabs";
import { GlassSurface } from "@/components/glass-surface";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions-panel";
import { useQuickActionsHost } from "@/components/quick-actions/quick-actions-host";
import { useQuickActions } from "@/components/quick-actions/use-quick-actions";
import { useActivity } from "@repo/hooks";
import { useAiSurfaces } from "@/lib/ai/availability";
import { activityCountChip } from "@/lib/activity/count-chip";
import { useActivityRereadOnTab } from "@/lib/activity/use-activity-reread";
import { TabLabel } from "@/components/tab-glyphs";
import { useTourAnchor } from "@/components/onboarding/tour";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  FLOATING_TAB_BAR,
  floatingTabBarBottom,
  floatingTabBarTop,
} from "@/lib/floating-chrome";
import { selectionHaptic } from "@/lib/haptics";
import type { QuickActionKey } from "@/lib/quick-actions";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The four tabs, in order (`spec/ui/mobile/navigation.md` § Tab bar): Chat,
 * Activity, Calendar (the `events` route) and More, since 2026-11-12
 * (#4610). The navigator holds only these (`app/(app)/(tabs)/_layout.tsx`);
 * every other screen is pushed on the stack above it and covers the bar
 * (`spec/ui/mobile/navigation.md` § Going back).
 */
export const TAB_ROUTES = ["index", "activity", "events", "more"] as const;

/** The pill's radius: half its height, so its ends are round. */
const PILL_RADIUS = FLOATING_TAB_BAR.height / 2;
/** The drawn row inside the pill, and the active tab's capsule. */
const TAB_HEIGHT = FLOATING_TAB_BAR.height - 12;

/**
 * The tab bar (owner pick 2026-11-06, after Bevel's): a glass pill holding the
 * four tabs, and beside it a round glass + that is always there on a tab
 * screen. The + opens the quick-actions panel above the bar and turns into an
 * X while it is open (`spec/ui/mobile/navigation.md` § Quick actions).
 *
 * Drawn as the navigator's whole `tabBar`, over the screens rather than under
 * them: the root fills the window and lets touches through everywhere it draws
 * nothing, so the scrim can cover the screen while the panel is open.
 */
export function GlassTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const { width } = useWindowDimensions();
  // Activity's tab carries the count of things waiting on the member
  // (`needs_you_count`), which More's Activity row carried before the screen
  // became a tab (#4610). It is read again on every change of tab, on every
  // return to the tabs from a pushed screen, on every visit to Activity, and
  // on every return to the app.
  const needsYou = activityCountChip(useActivity().data);
  const reduceMotion = useReducedMotion();
  const { shown, available, save, ready } = useQuickActions();
  // Two of the first-run tour's stops: the + and the More tab.
  const plusAnchor = useTourAnchor("quickActions");
  const moreAnchor = useTourAnchor("more");
  const { run, ask, sheets, notice } = useQuickActionsHost({
    events: available.includes("checkIn") || available.includes("hostCheckIn"),
  });

  const focusedRoute = state.routes[state.index];
  useActivityRereadOnTab(focusedRoute.key, focusedRoute.name === "activity");

  // Open on the tab it was opened from: moving to another tab closes it. The
  // close is kept, so coming back to the tab doesn't open it again (state
  // adjusted during render, as React's "storing information from previous
  // renders" does it, not in an effect).
  const [openOn, setOpenOn] = useState<string | null>(null);
  if (openOn !== null && openOn !== focusedRoute.key) setOpenOn(null);
  const open = openOn === focusedRoute.key;
  const [editing, setEditing] = useState(false);

  // The + turns into an X as the panel opens.
  const turn = useSharedValue(0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: reduceMotion ? 0 : 240 }));
  }, [open, reduceMotion, turn]);

  const openPanel = useCallback(
    (startEditing = false) => {
      selectionHaptic();
      setEditing(startEditing);
      setOpenOn(focusedRoute.key);
    },
    [focusedRoute.key],
  );
  const closePanel = useCallback(() => setOpenOn(null), []);

  // Android's back leaves editing first, then closes the panel.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (editing) setEditing(false);
        else closePanel();
        return true;
      },
    );
    return () => subscription.remove();
  }, [open, editing, closePanel]);

  // Ask is in the panel only for a member who has it; the server decides.
  const hasAsk = useAiSurfaces().ask;
  const openAsk = useCallback(() => {
    closePanel();
    ask();
  }, [ask, closePanel]);

  const runAction = useCallback(
    (key: QuickActionKey) => {
      closePanel();
      run(key);
    },
    [closePanel, run],
  );

  const bottomInset = useSafeAreaInsets().bottom;
  const barBottom = floatingTabBarBottom(bottomInset);
  // The panel and a confirmation sit this far above the window's bottom edge.
  const aboveBar = floatingTabBarTop(bottomInset) + FLOATING_TAB_BAR.actionGap;
  const pillRight =
    FLOATING_TAB_BAR.side +
    FLOATING_TAB_BAR.actionButton +
    FLOATING_TAB_BAR.actionGap;
  const panelWidth = width - FLOATING_TAB_BAR.side * 2;

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${45 * turn.get()}deg` }],
  }));
  // The panel grows out of the + below it; with Reduce Motion it fades.
  const panelEntering = reduceMotion ? FadeIn.duration(120) : growFromPlus;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {sheets}
      {open ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={StyleSheet.absoluteFill}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close quick actions"
            onPress={closePanel}
            style={[StyleSheet.absoluteFill, styles.scrim]}
          />
        </Animated.View>
      ) : null}

      {open ? (
        <Animated.View
          entering={panelEntering}
          exiting={FadeOut.duration(150)}
          style={[
            styles.panel,
            { left: FLOATING_TAB_BAR.side, bottom: aboveBar },
          ]}
          // Not accessibilityViewIsModal: that would hide the X and the
          // scrim from VoiceOver, its siblings. The escape gesture leaves
          // editing, then closes, as Android's back does.
          onAccessibilityEscape={() =>
            editing ? setEditing(false) : closePanel()
          }
        >
          <QuickActionsPanel
            shown={shown}
            available={available}
            width={panelWidth}
            editing={editing}
            canEdit={ready}
            onEditingChange={setEditing}
            onRun={runAction}
            onSave={save}
            onAsk={hasAsk ? openAsk : undefined}
          />
        </Animated.View>
      ) : null}

      {notice && !open ? (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(200)}
          pointerEvents="none"
          style={[styles.noticeRow, { bottom: aboveBar }]}
        >
          <GlassSurface style={styles.notice}>
            {/* Read out by the host's announceForAccessibility, on both
                    platforms, so no live region to say it twice. */}
            <Text
              style={[
                typeRole(tokens.typography.role.caption),
                { color: tokens.color.text.foreground },
              ]}
            >
              {notice}
            </Text>
          </GlassSurface>
        </Animated.View>
      ) : null}

      <View
        accessibilityRole="tablist"
        style={[
          styles.pillFrame,
          {
            left: FLOATING_TAB_BAR.side,
            right: pillRight,
            bottom: barBottom,
          },
        ]}
      >
        {/* GlassSurface clips to its own radius, so the pill's goes on it
                too, not only on the frame. */}
        <GlassSurface
          style={[StyleSheet.absoluteFill, { borderRadius: PILL_RADIUS }]}
        />
        <View style={styles.tabs}>
          {TAB_ROUTES.map((name) => {
            const route = state.routes.find(
              (candidate) => candidate.name === name,
            );
            if (!route) return null;
            const options = descriptors[route.key]?.options ?? {};
            const focused = focusedRoute.key === route.key;
            const color = focused ? accent : tokens.color.text.muted;
            const label = options.title ?? route.name;
            return (
              <Pressable
                key={route.key}
                ref={name === "more" ? moreAnchor : undefined}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={
                  name === "activity" && needsYou
                    ? `${label}, ${needsYou.spoken}`
                    : label
                }
                testID={`tab-${route.name}`}
                onPress={() => {
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name, route.params);
                  }
                }}
                onLongPress={() =>
                  navigation.emit({
                    type: "tabLongPress",
                    target: route.key,
                  })
                }
                style={styles.tab}
              >
                {/* The active tab sits on a soft capsule, as iOS 26's own
                        bars draw it, under the accent glyph and bold label
                        (iconography.md §1 rule 2). */}
                {focused ? <View style={styles.activeCapsule} /> : null}
                {options.tabBarIcon?.({ focused, color, size: 24 })}
                {name === "activity" && needsYou ? (
                  // A count is not direct address, so it is house gold, never
                  // the accent or mention red (components.md § App bar chips),
                  // as the Notifications count in Chat home's menu is.
                  <View
                    testID="tab-activity-badge"
                    pointerEvents="none"
                    style={[
                      styles.badge,
                      { backgroundColor: tokens.color.gold.house },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        { color: tokens.color.gold.onHouse },
                      ]}
                    >
                      {needsYou.label}
                    </Text>
                  </View>
                ) : null}
                <TabLabel focused={focused} color={color}>
                  {label}
                </TabLabel>
              </Pressable>
            );
          })}
        </View>
      </View>

      <GlassSurface
        style={[
          styles.plus,
          { right: FLOATING_TAB_BAR.side, bottom: barBottom },
        ]}
      >
        <Pressable
          ref={plusAnchor}
          // The Maestro flows tap the + by this id: open, its label is shared
          // with the scrim, whose center sits under the panel.
          testID="tab-plus"
          accessibilityRole="button"
          accessibilityLabel={open ? "Close quick actions" : "Quick actions"}
          accessibilityHint={
            open ? undefined : "Opens shortcuts to create and log things."
          }
          accessibilityState={{ expanded: open }}
          onPress={open ? closePanel : () => openPanel()}
          // Holding the + goes straight to editing the panel, once the
          // member's role is in hand (`useQuickActions().ready`).
          onLongPress={() =>
            open ? ready && setEditing(true) : openPanel(ready)
          }
          delayLongPress={400}
          style={({ pressed }) => [
            styles.plusPress,
            pressed && styles.plusPressed,
          ]}
        >
          <Animated.View style={plusStyle}>
            <Svg
              width={26}
              height={26}
              viewBox="0 0 24 24"
              fill="none"
              stroke={tokens.color.text.foreground}
              strokeWidth={2.2}
              strokeLinecap="round"
            >
              <Path d="M12 5v14M5 12h14" />
            </Svg>
          </Animated.View>
        </Pressable>
      </GlassSurface>
    </View>
  );
}

/** The panel's entrance: from a third of its size at the +, to full. */
function growFromPlus() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.4 }] },
    animations: {
      opacity: withTiming(1, { duration: 180 }),
      transform: [{ scale: withTiming(1, { duration: 240 }) }],
    },
  };
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.40)" },
  noticeRow: {
    position: "absolute",
    left: FLOATING_TAB_BAR.side,
    right: FLOATING_TAB_BAR.side,
    alignItems: "center",
  },
  // A capsule sized to its line, the back capsule's height.
  notice: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    justifyContent: "center",
  },
  panel: {
    position: "absolute",
    // Grows out of the + below it, at the panel's bottom right.
    transformOrigin: "bottom right",
  },
  pillFrame: {
    position: "absolute",
    height: FLOATING_TAB_BAR.height,
    borderRadius: PILL_RADIUS,
  },
  tabs: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  badge: {
    position: "absolute",
    top: 4,
    left: "50%",
    marginLeft: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...typeRole({ size: 11, weight: 700 }),
    lineHeight: 14,
  },
  tab: {
    flex: 1,
    height: TAB_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  activeCapsule: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: TAB_HEIGHT / 2,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  plus: {
    position: "absolute",
    width: FLOATING_TAB_BAR.actionButton,
    height: FLOATING_TAB_BAR.actionButton,
    borderRadius: FLOATING_TAB_BAR.actionButton / 2,
  },
  plusPress: { flex: 1, alignItems: "center", justifyContent: "center" },
  plusPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
});
