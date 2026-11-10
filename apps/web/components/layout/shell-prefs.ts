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

export const CHAT_SPLIT_COOKIE = "frapp_chat_split";

/** 50/50 between the messages and the tool page. */
export const DEFAULT_TOOL_SHARE = 0.5;

/**
 * The tool page's share of the width after the channels column, 0 to 1. A
 * missing or foreign value is the default; the floors are CSS's to hold, so
 * any share in range is safe at any width.
 */
export function parseToolShare(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TOOL_SHARE;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_TOOL_SHARE;
  return n;
}

export function persistToolShare(share: number): void {
  writePreferenceValue(CHAT_SPLIT_COOKIE, share.toFixed(3));
}
