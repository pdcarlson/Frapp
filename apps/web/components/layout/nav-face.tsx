"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * The left column's two faces on `/chat` (owner, 2026-11-05).
 *
 * On every other route the left column is the module nav. On `/chat` it is the
 * channel list, and a back arrow beside the Channels heading slides the module
 * nav in over it without leaving Chat; the Chat row slides the channels back.
 * Chat used to spend 460px on the nav and the channel list side by side before
 * a single message (`spec/ui/web-dashboard/README.md` § Chat).
 *
 * The shell owns the column and which face shows. Chat owns what the channels
 * face holds, because the list, its filters and its selection are chat state:
 * `ChatShell` portals its channels pane into `channelsSlot`. A context rather
 * than props, because the shell renders the route as `children` and has no
 * other way to hand the route an element.
 */

export type NavFace = "channels" | "modules";

export type NavFaceContextValue = {
  face: NavFace;
  showModules: () => void;
  showChannels: () => void;
  /**
   * The channels face's container, or `null` until it mounts (and on the
   * server). Below `lg` it exists but is hidden with the rest of the desktop
   * column, so a reader also checks `useIsDesktopShell()` before portaling.
   */
  channelsSlot: HTMLElement | null;
};

export const NavFaceContext = createContext<NavFaceContextValue | null>(null);

/**
 * The shell's nav-face controls, or `null` outside the dashboard shell (a test
 * harness, a route outside `(dashboard)`), where the channels pane stays inline.
 */
export function useNavFace(): NavFaceContextValue | null {
  return useContext(NavFaceContext);
}

/** The routes whose left column is the channel list. */
export function isChannelsNavRoute(pathname: string | null): boolean {
  return pathname === "/chat" || Boolean(pathname?.startsWith("/chat/"));
}

/**
 * The shell's one breakpoint, `lg` (1024px), where the left column appears and
 * the drawer goes away (`spec/ui/web-dashboard/README.md` § Responsive contract).
 */
const DESKTOP_SHELL_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DESKTOP_SHELL_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DESKTOP_SHELL_QUERY).matches;
}

/**
 * Whether the desktop column is on screen. `false` on the server and through
 * hydration: the channels pane renders inline (hidden from `lg` up) until the
 * client knows, while the shell's own placeholder holds the column's place, so
 * no width moves on first paint.
 */
export function useIsDesktopShell(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
