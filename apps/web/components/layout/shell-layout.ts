"use client";

import { useMediaQuery } from "@/lib/use-media-query";

export { useMediaQueryState } from "@/lib/use-media-query";

/**
 * The desktop shell's layout state: chat as a panel beside the chapter tools
 * (#3779, approved by Paul 2026-11-10; the tool first since #5575).
 *
 * The nav column always stays. Its Chat row opens and closes the chat panel;
 * a tool row opens that tool's page, and clicking the open tool's row closes
 * it. Chat and one tool can be open together: the tool page takes the main
 * column right of the nav, and chat is a side panel on the right with a
 * draggable divider between them (#5575, Paul 2026-11-19: at 1440px the tool
 * used to get the narrower share, beside chat's channels column, and clipped
 * what it showed in full at 820px). Beside a tool the panel is one pane at a
 * time, the list or the conversation, as on a phone. With nothing open the
 * shell draws the chapter's home view.
 *
 * - **The open tool is the URL** (`/events`), so links and Back work as they
 *   always did. `/chat` is "no tool": chat alone, or the home view when chat
 *   is closed.
 * - **Which list chat shows is a cookie too** (#3774): the chapter's
 *   channels, or the member's direct messages. The nav's Chat and Direct
 *   messages rows switch the one panel between them.
 * - **Chat open or closed is a cookie**, and so is the side panel's width,
 *   both read by the dashboard layout on the server so the first paint is
 *   right. They live in `shell-prefs.ts`, which the server imports, so it
 *   holds no hooks.
 *
 * Side by side needs room for both 375px floors (the width the thread is
 * tested at) beside the full nav, so it starts at `SPLIT_MIN_WIDTH`. Below it
 * the shell is the single page it was: `/chat` shows chat, a tool route shows
 * the tool, and the Chat row is a link.
 */

/** The width every side-by-side column keeps, chat's panel and the tool page. */
export const PANE_FLOOR = 375;
const NAV_WIDTH = 240;
/** Hairlines: the nav's and the divider's. */
const HAIRLINES = 2;

/** Full nav + two floors + hairlines (992), at the home view's 1056. */
export const SPLIT_MIN_WIDTH = 1056;

// Asserted here rather than left to arithmetic in a comment.
if (NAV_WIDTH + 2 * PANE_FLOOR + HAIRLINES > SPLIT_MIN_WIDTH) {
  throw new Error(
    "shell-layout: the split breakpoint is below the pane floors",
  );
}

export const SPLIT_QUERY = `(min-width: ${SPLIT_MIN_WIDTH}px)`;

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
 * Tool routes that take the whole row: chat closes beside them and comes back
 * on leaving (decision 3 of #4068, Paul 2026-11-10). Chapter settings is a
 * grouped rail beside a form; beside chat at a 1280px window its Chapter form
 * was about 150px wide. Chat's open state is left alone, so the next tool
 * page finds it where the member left it.
 */
export function isFullWidthToolRoute(pathname: string | null): boolean {
  return (
    pathname === "/settings" || Boolean(pathname?.startsWith("/settings/"))
  );
}

/**
 * The chat panel's widths a row of `rowWidth` pixels allows: the panel at
 * least `PANE_FLOOR`, and the tool page beside it (the divider's `w-2 -mx-1`
 * takes no width of its own)
 * at least `PANE_FLOOR`. On a row too narrow for both, both bounds are the
 * floor.
 */
export function chatWidthBounds(rowWidth: number): {
  min: number;
  max: number;
} {
  return {
    min: PANE_FLOOR,
    max: Math.max(PANE_FLOOR, Math.floor(rowWidth - PANE_FLOOR)),
  };
}

export function clampChatWidth(width: number, rowWidth: number): number {
  const { min, max } = chatWidthBounds(rowWidth);
  return Math.round(Math.min(max, Math.max(min, width)));
}
