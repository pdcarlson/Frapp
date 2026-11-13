import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether anything is open over the screens: a bottom sheet (every one draws
 * `SheetScrim`, which reports here) or the tab bar's + panel.
 *
 * A sheet is a portal, not a route, so the screen under it stays focused and
 * has no way to know it is covered. Something that plays by itself on a
 * screen at rest needs to know: the swipe hint on Chat home
 * (`components/chat/messages-swipe-area.tsx`) played, and spent its one
 * showing, behind the What's new sheet that opens on the same launch
 * (#4610 step 3's review). It reads this and waits.
 *
 * A count, not a flag: sheets stack, and the one underneath is still open.
 */

let open = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Marks one overlay open; the returned call marks it closed, once. */
export function holdOverlay(): () => void {
  open += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open -= 1;
    emit();
  };
}

export function isOverlayOpen(): boolean {
  return open > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether any overlay is open, re-rendering when that changes. */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, isOverlayOpen, isOverlayOpen);
}

/** Reports an overlay as open while `present`, and while mounted. */
export function useOverlayPresence(present = true): void {
  useEffect(() => (present ? holdOverlay() : undefined), [present]);
}
