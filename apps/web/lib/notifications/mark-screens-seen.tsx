"use client";

import { useMarkNotificationScreensSeen } from "@repo/hooks";
import { usePageVisible } from "@/lib/notifications/use-page-visible";

/**
 * Reads the notifications about what is on screen, for a view that has no
 * route of its own for `seen-screens.ts` to map: the report queue and Discord
 * import, which open inside Chapter settings (#3837). Rendered beside the
 * view, so it reads them while the view is open and the tab is showing, the
 * way visiting `/chat-admin` or `/discord-import` did.
 */
export function MarkScreensSeen({ screens }: { screens: readonly string[] }) {
  useMarkNotificationScreensSeen(screens, { enabled: usePageVisible() });
  return null;
}
