import React from "react";
import { vi } from "vitest";

/**
 * The suite's `react-native`, which `vitest.setup.ts` mocks the module with.
 *
 * It lives in its own module so a spec can extend it rather than restate it:
 * `vi.mock("react-native", …)` in a spec replaces the setup's mock outright,
 * and its `importOriginal` is react-native-web, not this. A spec that needs a
 * different stand-in (see {@link RenderingFlatList}) spreads this object and
 * overrides the one entry.
 */
export const reactNativeStub = {
  Platform: {
    OS: "ios",
    select: vi.fn((opts) => opts.ios),
  },
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    removeEventListener: vi.fn(),
    currentState: "active",
  },
  // s10 confirms "End session" through the native dialog, because
  // `spec/ui/mobile/README.md` names ending a session early as an action that
  // needs one and bans `window.confirm` outright. A spec that drives that path
  // reads the buttons off this mock rather than tapping an in-product dialog
  // that does not exist.
  Alert: {
    alert: vi.fn(),
  },
  // Outcomes a sighted member reads off the screen are announced to VoiceOver
  // through this, because `accessibilityLiveRegion` is Android-only. A spec
  // asserting on it clears it itself (`clearMocks` is off, see the config).
  AccessibilityInfo: {
    announceForAccessibility: vi.fn(),
    // An overlay moves a screen reader's focus onto itself as it appears
    // (spec/ui/mobile/patterns.md § Overlays).
    sendAccessibilityEvent: vi.fn(),
  },
  // Enough of the styling/layout surface for Signet token factories and
  // component tests; string stand-ins render fine under react-test-renderer.
  StyleSheet: {
    create: <T>(styles: T) => styles,
    flatten: (style: unknown) => style,
    hairlineWidth: 1,
  },
  useColorScheme: () => "dark",
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  // Added with the chat attachment renderer (#1229), which previews image
  // attachments inline.
  Image: "Image",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
  // The chat thread windows its messages with a FlatList. As a string stand-in
  // it renders its props but never invokes `renderItem`, so a test that needs
  // to assert on a row should call the row component directly. A spec that
  // needs the rows inside the screen's own tree swaps in `RenderingFlatList`
  // below.
  FlatList: "FlatList",
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Share: {
    share: vi.fn().mockResolvedValue({ action: "sharedAction" }),
  },
  // The update gate (#2526) holds Android's back button while it blocks and
  // dismisses any open keyboard when it appears.
  BackHandler: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Keyboard: {
    dismiss: vi.fn(),
  },
};

/**
 * A `FlatList` that draws its rows, for a spec that has to see them where the
 * screen puts them: inside a context provider the screen wraps the list in,
 * say. It renders every item (no windowing) and then `ListFooterComponent`,
 * inside a host `FlatList` node that carries the list's props, so a spec can
 * still read `inverted`, `onEndReached` and the rest off it.
 *
 * Opt-in, per spec:
 *
 * ```ts
 * vi.mock("react-native", async () => {
 *   const { reactNativeStub, RenderingFlatList } = await import("@/test/react-native-stub");
 *   return { ...reactNativeStub, FlatList: RenderingFlatList };
 * });
 * ```
 *
 * The suite-wide default stays the string stand-in, which never calls
 * `renderItem`, so a spec that only needs a row renders that row directly.
 */
export function RenderingFlatList<T>(props: {
  data?: readonly T[] | null;
  renderItem?: (info: { item: T; index: number }) => React.ReactNode;
  keyExtractor?: (item: T, index: number) => string;
  ListFooterComponent?: React.ComponentType | React.ReactElement | null;
}) {
  const { data, renderItem, keyExtractor, ListFooterComponent: Footer } = props;
  const rows = (data ?? []).map((item, index) =>
    React.createElement(
      React.Fragment,
      { key: keyExtractor ? keyExtractor(item, index) : String(index) },
      renderItem ? renderItem({ item, index }) : null,
    ),
  );
  const footer = !Footer
    ? null
    : React.isValidElement(Footer)
      ? Footer
      : React.createElement(Footer as React.ComponentType);
  return React.createElement("FlatList", props, ...rows, footer);
}
