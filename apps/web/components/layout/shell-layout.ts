"use client";

import { useMediaQuery } from "@/lib/use-media-query";

export { useMediaQueryState } from "@/lib/use-media-query";

/**
 * The desktop shell's layout state: chat as a panel beside the chapter tools
 * (#3779, approved by Paul 2026-11-10).
 *
 * The nav column always stays. Its Chat row opens and closes the chat panel;
 * a tool row opens that tool's page, and clicking the open tool's row closes
 * it. Chat and one tool can be open together, chat on the left, the tool page
 * on the right, with a draggable divider between them. With nothing open the
 * shell draws the chapter's home view.
 *
 * - **The open tool is the URL** (`/events`), so links and Back work as they
 *   always did. `/chat` is "no tool": chat alone, or the home view when chat
 *   is closed.
 * - **Chat open or closed is a cookie**, and so is the split (the tool page's
 *   share of the width left after the channels column), both read by the
 *   dashboard layout on the server so the first paint is right. They live in
 *   `shell-prefs.ts`, which the server imports, so it holds no hooks.
 *
 * Side by side needs room for both 375px floors (the width the thread is
 * tested at), so it starts at `SPLIT_MIN_WIDTH`. Below it the shell is the
 * single page it was: `/chat` shows chat, a tool route shows the tool, and the
 * Chat row is a link. Between `SPLIT_MIN_WIDTH` and `FULL_NAV_SPLIT_WIDTH` the
 * nav drops to its 56px rail while chat and a tool are both open.
 */

/** The width every side-by-side column keeps, chat's messages and the tool page. */
export const PANE_FLOOR = 375;
/** The channels column inside the chat panel. */
export const CHANNELS_WIDTH = 240;
const NAV_WIDTH = 240;
const RAIL_WIDTH = 56;
/** Hairlines: the nav's, the channels column's, and the divider's. */
const HAIRLINES = 3;

/** Rail + channels + two floors + hairlines (1049), rounded up. */
export const SPLIT_MIN_WIDTH = 1056;
/** Full nav + channels + two floors + hairlines (1233), rounded up. */
export const FULL_NAV_SPLIT_WIDTH = 1240;

// Asserted here rather than left to arithmetic in a comment.
if (
  RAIL_WIDTH + CHANNELS_WIDTH + 2 * PANE_FLOOR + HAIRLINES > SPLIT_MIN_WIDTH ||
  NAV_WIDTH + CHANNELS_WIDTH + 2 * PANE_FLOOR + HAIRLINES > FULL_NAV_SPLIT_WIDTH
) {
  throw new Error("shell-layout: split breakpoints are below the pane floors");
}

export const SPLIT_QUERY = `(min-width: ${SPLIT_MIN_WIDTH}px)`;
export const FULL_NAV_SPLIT_QUERY = `(min-width: ${FULL_NAV_SPLIT_WIDTH}px)`;

/**
 * The shell's lg breakpoint (1024px), where the left column appears and the
 * drawer goes away (`spec/ui/web-dashboard/README.md` § Responsive contract).
 */
const DESKTOP_SHELL_QUERY = "(min-width: 1024px)";

/** Whether the desktop column is on screen. `false` on the server. */
export function useIsDesktopShell(): boolean {
  return useMediaQuery(DESKTOP_SHELL_QUERY);
}

/** The routes that hold no tool page: chat alone, or the home view. */
export function isChatRoute(pathname: string | null): boolean {
  return pathname === "/chat" || Boolean(pathname?.startsWith("/chat/"));
}

/**
 * The shares a row of `rowWidth` pixels allows: the tool page at least
 * `PANE_FLOOR`, and the messages (the chat panel less its channels column) at
 * least `PANE_FLOOR`. On a row too narrow for both, both bounds meet at 0.5.
 */
export function toolShareBounds(rowWidth: number): {
  min: number;
  max: number;
} {
  const flexible = rowWidth - CHANNELS_WIDTH - 1;
  if (flexible <= 2 * PANE_FLOOR) return { min: 0.5, max: 0.5 };
  return {
    min: PANE_FLOOR / flexible,
    max: 1 - PANE_FLOOR / flexible,
  };
}

export function clampToolShare(share: number, rowWidth: number): number {
  const { min, max } = toolShareBounds(rowWidth);
  return Math.min(max, Math.max(min, share));
}
