import { TimeToFullDisplay } from "@sentry/react-native";

/**
 * Marks the moment a screen shows what a member opened it for, so Sentry can
 * time it (`spec/behavior/observability.md` § Speed budget, #4342).
 *
 * Sentry's Expo Router integration (`app/_layout.tsx`) starts a navigation
 * span on every route change and times its first frame (time to initial
 * display). That first frame is usually a skeleton, so it says little about
 * how long a member waits. This records time to full display: the first frame
 * after `ready` turns true, as a `ui.load.full_display` span on the same
 * navigation. The budget names chat home and a channel; the Directory is
 * measured too, because it is the largest list a member opens.
 *
 * `ready` is the screen's own "the content is here" condition, the one that
 * swaps its skeleton for rows. An error or empty state counts as ready: the
 * member is no longer waiting, and a span left open would be dropped as a
 * timeout rather than counted as slow.
 *
 * Renders a zero-size native view. Where the native view is missing (Expo Go,
 * the vitest suite) the SDK renders nothing and records nothing.
 */
export function ScreenReady({ ready }: { ready: boolean }) {
  return <TimeToFullDisplay record={ready} />;
}
