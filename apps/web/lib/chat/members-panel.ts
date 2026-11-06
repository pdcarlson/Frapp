import { useSyncExternalStore } from "react";

/**
 * Persistence for Chat's member list column (#3536): shown or hidden, from
 * 1280px up, where the column sits beside the timeline.
 *
 * A cookie for the reason `components/layout/nav-collapse.ts` gives: the
 * route reads it on the server, so a member who hid the column never sees it
 * paint and then vanish after hydration. Below 1280px the same toggle opens a
 * sheet instead, which is never remembered.
 *
 * Not `httpOnly`: the toggle writes it from the client, and it carries no
 * identity and gates no access.
 */

export const CHAT_MEMBERS_HIDDEN_COOKIE = "frapp_chat_members_hidden";

/** A year, as the nav collapse preference. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Anything other than the literal `"1"` reads as shown: the column is on by
 * default (owner, 2026-11-05), so an absent or foreign value shows it.
 */
export function parseMembersHidden(value: string | undefined): boolean {
  return value === "1";
}

export function persistMembersHidden(hidden: boolean): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${CHAT_MEMBERS_HIDDEN_COOKIE}=${hidden ? "1" : "0"}` +
    `; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}

/** Where the member list is a column rather than a sheet: Tailwind's `xl`. */
const WIDE_CHAT_QUERY = "(min-width: 1280px)";

function subscribeWide(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(WIDE_CHAT_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function wideSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(WIDE_CHAT_QUERY).matches;
}

/**
 * Whether the member list is a column (1280px up) or a sheet. Only decides
 * what the toggle does and how it is named; the column itself is shown and
 * hidden by CSS (`hidden xl:flex`), so first paint never waits on this, which
 * reads `false` on the server and through hydration.
 */
export function useIsWideChat(): boolean {
  return useSyncExternalStore(subscribeWide, wideSnapshot, () => false);
}
