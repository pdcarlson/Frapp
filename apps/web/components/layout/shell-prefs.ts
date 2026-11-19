import {
  writePreferenceCookie,
  writePreferenceValue,
} from "@/components/layout/nav-collapse";

/**
 * The chat panel's remembered layout (#3779; `shell-layout.ts` has the model).
 * Cookies, for the reason `nav-collapse.ts` gives: the dashboard layout reads
 * them on the server, so the first paint is already right.
 *
 * The server layout imports this module, so it must stay free of React hooks
 * and of `"use client"` (`lib/chat/members-panel.ts` says what breaks).
 */

export const CHAT_OPEN_COOKIE = "frapp_chat_open";

/** Open unless the member closed it: chat beside a tool is the default. */
export function parseChatOpen(value: string | undefined): boolean {
  return value !== "0";
}

export function persistChatOpen(open: boolean): void {
  writePreferenceCookie(CHAT_OPEN_COOKIE, open);
}

export const CHAT_WIDTH_COOKIE = "frapp_chat_width";

/**
 * The side panel's width beside a tool, in pixels (#5575). The floor, so at
 * 1440px the tool page keeps the width it has alone at 820px.
 */
export const DEFAULT_CHAT_WIDTH = 375;

/**
 * A missing or foreign value is the default. Any width is safe to lay out:
 * CSS holds both floors (`dashboard-shell.tsx`), so a width saved at a wider
 * window still fits a narrower one.
 */
export function parseChatWidth(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CHAT_WIDTH;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 4000) return DEFAULT_CHAT_WIDTH;
  return Math.round(n);
}

export function persistChatWidth(width: number): void {
  writePreferenceValue(CHAT_WIDTH_COOKIE, String(Math.round(width)));
}

/**
 * Which list the chat panel shows (#3774): the chapter's channels, or the
 * member's direct messages. The nav's Chat and Direct messages rows switch
 * one panel between them, so the shell remembers the last one for the next
 * page load, the way it remembers open or closed.
 */
export const CHAT_VIEW_COOKIE = "frapp_chat_view";

export type ChatView = "channels" | "direct";

/** Channels unless the member last had direct messages open. */
export function parseChatView(value: string | null | undefined): ChatView {
  return value === "direct" ? "direct" : "channels";
}

export function persistChatView(view: ChatView): void {
  writePreferenceValue(CHAT_VIEW_COOKIE, view);
}
