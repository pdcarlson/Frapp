import { writePreferenceCookie } from "@/components/layout/nav-collapse";

/**
 * Persistence for Chat's member list column (#3536): shown or hidden, from
 * 1280px up, where the column sits beside the timeline.
 *
 * A cookie for the reason `components/layout/nav-collapse.ts` gives: the
 * route reads it on the server (`app/(dashboard)/chat/page.tsx`), so a member
 * who hid the column never sees it paint and then vanish after hydration.
 * Below 1280px the same toggle opens a sheet instead, which is never
 * remembered.
 *
 * The server page imports this module, so it must stay free of React hooks:
 * a `useSyncExternalStore` import here fails the production build with an
 * RSC boundary error (vitest has no such boundary and never notices).
 */

export const CHAT_MEMBERS_HIDDEN_COOKIE = "frapp_chat_members_hidden";

/**
 * Anything other than the literal `"1"` reads as shown: the column is on by
 * default (owner, 2026-11-05), so an absent or foreign value shows it.
 */
export function parseMembersHidden(value: string | undefined): boolean {
  return value === "1";
}

export function persistMembersHidden(hidden: boolean): void {
  writePreferenceCookie(CHAT_MEMBERS_HIDDEN_COOKIE, hidden);
}

/**
 * Where the member list is a column (1280px up, Tailwind's `xl`) rather than
 * a sheet. The shell matches it with `useMediaQuery` to decide what the toggle
 * does and whether the column's read runs; the column itself is shown and
 * hidden by CSS (`hidden xl:flex`), so first paint never waits on it.
 */
export const WIDE_CHAT_QUERY = "(min-width: 1280px)";
