import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useBackToClose } from "@/lib/overlay";

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
