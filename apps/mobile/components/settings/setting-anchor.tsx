import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Animated, StyleSheet, View, type ScrollView } from "react-native";
import { settingEntryById } from "@repo/hooks";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, useFrappTheme } from "@/lib/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";

/**
 * Lighting the setting a search opened, on the phone: the counterpart of
 * web's `use-setting-jump.ts`. A screen that holds settings wraps itself in
 * `SettingJumpProvider` with its scroll view and the setting asked for (the
 * `setting` route param, or a pick from its own search), and wraps each
 * setting's rows in a `SettingAnchor` named by the index's `phone.anchor`
 * (`settings-search.ts` in `@repo/hooks`). The asked-for anchor scrolls
 * itself into view and takes a chapter-accent wash that holds and fades, as
 * iOS Settings lights the row its search lands on.
 */

type JumpContext = {
  /** The anchor to light, or null. */
  anchor: string | null;
  /** Bumped per jump, so the same row lit twice lights twice. */
  serial: number;
  scrollRef: RefObject<ScrollView | null>;
};

const SettingJumpContext = createContext<JumpContext | null>(null);

/**
 * The jump state for a settings screen: `jump(settingId)` lights a setting on
 * this screen. Seeded from the route's `setting` param.
 */
export function useSettingJumpState(initialSettingId?: string | null) {
  const [state, setState] = useState(() => ({
    anchor: settingEntryById(initialSettingId)?.phone?.anchor ?? null,
    serial: 0,
  }));
  const jump = useCallback((settingId: string) => {
    const anchor = settingEntryById(settingId)?.phone?.anchor ?? null;
    setState((prev) => ({ anchor, serial: prev.serial + 1 }));
  }, []);
  return { ...state, jump };
}

export function SettingJumpProvider({
  anchor,
  serial,
  scrollRef,
  children,
}: JumpContext & { children: ReactNode }) {
  return (
    <SettingJumpContext.Provider value={{ anchor, serial, scrollRef }}>
      {children}
    </SettingJumpContext.Provider>
  );
}

/** Room left above the lit row, so it sits under the back row, not behind it. */
const SCROLL_MARGIN = 120;

export function SettingAnchor({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const ctx = useContext(SettingJumpContext);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const reduceMotion = useReduceMotion();
  const ref = useRef<View>(null);
  const [wash] = useState(() => new Animated.Value(0));
  const lit = ctx?.anchor === id;
  const serial = ctx?.serial ?? 0;
  const scrollRef = ctx?.scrollRef;

  useEffect(() => {
    if (!lit) return;
    // A frame for the screen's rows to lay out, more on a cold push.
    const timer = setTimeout(() => {
      const scroll = scrollRef?.current;
      const inner = (
        scroll as unknown as { getInnerViewRef?: () => unknown } | null
      )?.getInnerViewRef?.();
      if (scroll && inner && ref.current) {
        ref.current.measureLayout(
          inner as never,
          (_x, y) =>
            scroll.scrollTo({
              y: Math.max(0, y - SCROLL_MARGIN),
              animated: !reduceMotion,
            }),
          () => {},
        );
      }
      wash.setValue(1);
      if (!reduceMotion) {
        Animated.sequence([
          Animated.delay(1200),
          Animated.timing(wash, {
            toValue: 0,
            duration: 900,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        setTimeout(() => wash.setValue(0), 2000);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [lit, serial, scrollRef, reduceMotion, wash]);

  return (
    // The screen's gap between its blocks, for an anchor around several (a
    // heading, its rows and their footnote).
    <View ref={ref} collapsable={false} style={{ gap: tokens.spacing.md }}>
      {children}
      <Animated.View
        pointerEvents="none"
        testID={lit ? `setting-lit-${id}` : undefined}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: tint(accent, 0.22), opacity: wash },
        ]}
      />
    </View>
  );
}
