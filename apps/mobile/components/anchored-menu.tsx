import { type ReactNode, useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { SignetTokens } from "@repo/theme/signet";
import { useBackToClose } from "@/lib/overlay";
import { useFrappTheme } from "@/lib/theme";

/** Where a menu drawn by `ScreenShell`'s `overlay` opens, in window points. */
export type MenuAnchor = { top: number; left: number };

export type AnchoredMenuState = {
  visible: boolean;
  anchor: MenuAnchor;
  open: (anchor: MenuAnchor) => void;
  close: () => void;
};

/**
 * Open-and-where state for a small menu drawn over a tab screen by
 * `ScreenShell`'s `overlay`: Chat home's channel filters
 * (`components/chat/channel-filter-menu.tsx`) and its chapter menu
 * (`components/chat/chapter-menu.tsx`).
 */
export function useAnchoredMenu(): AnchoredMenuState {
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<MenuAnchor>({ top: 0, left: 0 });
  const close = useCallback(() => setVisible(false), []);
  const open = useCallback((at: MenuAnchor) => {
    setAnchor(at);
    setVisible(true);
  }, []);
  // The overlay takes every tap while it is up, so Android back closes it
  // instead of leaving the tab.
  useBackToClose(visible, close);
  // The tab bar sits outside the overlay and still takes taps, and a push can
  // open a thread over the tab. The screen stays mounted under either, so
  // close on blur: an open menu would otherwise hold Android back on the
  // next screen and still be open on return.
  useFocusEffect(useCallback(() => close, [close]));
  return { visible, anchor, open, close };
}

/**
 * The drawn menu both share: a backdrop that closes it on a tap outside, and
 * the popover card at its anchor. No title and no Cancel row
 * (components.md § Chrome weight): a tap outside, Android back and
 * VoiceOver's escape gesture close it. Renders nothing while closed.
 */
export function AnchoredMenuShell({
  menu,
  width,
  backdropTestID,
  children,
}: {
  menu: AnchoredMenuState;
  width: number;
  backdropTestID: string;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (!menu.visible) return null;
  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={menu.close}
      style={styles.fill}
    >
      <Pressable
        testID={backdropTestID}
        accessible={false}
        importantForAccessibility="no"
        onPress={menu.close}
        style={styles.fill}
      />
      <View
        style={[
          styles.menu,
          { width, top: menu.anchor.top, left: menu.anchor.left },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    fill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    menu: {
      position: "absolute",
      paddingHorizontal: tokens.spacing.md,
      backgroundColor: tokens.color.surface.popover,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.control,
    },
  });
}
