import { View } from "react-native";
import { useIsFocused } from "expo-router";
import { TimeToFullDisplay } from "@sentry/react-native";

/**
 * Marks the moment a screen shows what a member opened it for, so Sentry can
 * time it (`spec/behavior/observability.md` § Speed budget, #4342).
 *
 * Every route change gets a navigation span with its first frame timed (time
 * to initial display, `app/_layout.tsx`). That first frame is usually a
 * skeleton, so this adds time to full display: the first frame after `ready`
 * turns true, as a `ui.load.full_display` span under the active navigation.
 *
 * `ready` is the screen's own "the content is here" condition, the one that
 * swaps its skeleton for rows. An error or empty state counts as ready: the
 * member is no longer waiting, and a span left open would be dropped as a
 * timeout rather than counted as slow.
 *
 * Only while the screen is focused. The SDK reads the active span on every
 * render, and a screen left mounted underneath (chat home is a tab; a channel
 * stays under whatever is pushed over it) re-renders when it blurs and on
 * realtime updates. Unfocused, a true `ready` would stamp its own moment onto
 * the next screen's navigation.
 *
 * Absolutely positioned, so the zero-size view the SDK draws (a native
 * reporter, or a plain `View` where that is missing, as in Expo Go) takes no
 * part in its parent's layout or `gap`.
 */
export function ScreenReady({ ready }: { ready: boolean }) {
  const focused = useIsFocused();
  return (
    <View style={{ position: "absolute" }} pointerEvents="none">
      <TimeToFullDisplay ready={ready && focused} />
    </View>
  );
}
