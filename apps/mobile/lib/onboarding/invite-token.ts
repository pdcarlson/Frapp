/**
 * Invite tokens arrive as a pasted secret, a `?token=` query on `/join`, or a
 * full web/app URL (`app.frapp.live/join?token=…`, `frapp://join?token=…`).
 *
 * Extraction lives in `@repo/validation` so web `/join` and this screen cannot
 * drift. The remembered invite is mobile-only: it waits through the sign-in
 * on the invite card, and a relaunch, until it is joined or declined.
 *
 * The drawn s02 six-cell code is a Canvas shorthand. Joining is single-use
 * invite tokens (`spec/behavior/onboarding.md`), not a shared 6-character
 * chapter code — `screens.md` already omits the drawn "Join code" row for the
 * same reason.
 */

import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { extractInviteToken } from "@repo/validation";

export {
  extractInviteToken,
  extractInviteTokenFromQuery,
} from "@repo/validation";

/**
 * What a sign-in started from the invite card came back to do (#5625): join,
 * or ask the sender for a new link. Web carries the same mark as `then=` on
 * the `/join` URL (`apps/web/lib/auth/join-visit.ts`); here it rides with the
 * remembered invite, since a sign-in leaves the screen.
 */
export type JoinThen = "join" | "ask";

type RememberedInvite = { token: string; then: JoinThen | null; at: number };

const STORAGE_KEY = "frapp.mobile.pending-invite";
/** As long as a personal invite lives (#5625): past that it can't be joined. */
export const REMEMBER_INVITE_MS = 7 * 24 * 60 * 60 * 1000;

let remembered: RememberedInvite | null = null;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/**
 * Kept on the phone as well as in memory (#5625): a sign-in can leave the app
 * (the email's link opens it again, Android may close it under the provider's
 * page), and the invite has to be waiting when the member comes back, or the
 * one tap that should join them lands on the empty question instead.
 */
function persist(): void {
  const value = remembered;
  void (async () => {
    try {
      if (value) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      else await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // Memory still holds it for this run; only a relaunch would lose it.
    }
  })();
}

function parse(raw: string | null, now: number): RememberedInvite | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RememberedInvite>;
    if (typeof value.token !== "string" || value.token.length === 0) {
      return null;
    }
    if (typeof value.at !== "number" || now - value.at > REMEMBER_INVITE_MS) {
      return null;
    }
    const then =
      value.then === "join" || value.then === "ask" ? value.then : null;
    return { token: value.token, then, at: value.at };
  } catch {
    return null;
  }
}

/**
 * Reads the invite a past run left on the phone, once per run. Memory wins:
 * an invite remembered in this run is newer than anything stored.
 */
export function hydrateRememberedInvite(now = Date.now()): Promise<void> {
  hydration ??= (async () => {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (remembered) return;
    const stored = parse(raw, now);
    if (stored) {
      remembered = stored;
      changed();
    } else if (raw) {
      persist();
    }
  })();
  return hydration;
}

/**
 * Remembers an invite until it is joined or declined: across the sign-in on
 * the invite card, and across a relaunch. `then` marks a sign-in started from
 * the card, which carries on with what the member tapped.
 */
export function rememberInviteToken(
  token: string | null,
  then: JoinThen | null = null,
): void {
  if (!token || token.length === 0) return;
  remembered = { token, then, at: Date.now() };
  persist();
  changed();
}

/** Clears the mark once it has been acted on; the invite stays remembered. */
export function clearRememberedInviteThen(): void {
  if (!remembered || remembered.then === null) return;
  remembered = { ...remembered, then: null };
  persist();
  changed();
}

/** The remembered invite, left in place (`consumeRememberedInviteToken` takes it). */
export function peekRememberedInviteToken(): string | null {
  return remembered?.token ?? null;
}

/**
 * How long a tap on the card keeps its intent. A sign-in that was abandoned
 * (the provider's page closed) leaves the mark behind; past this, signing in
 * some other way later shows the card instead of joining on its own.
 */
export const JOIN_THEN_MS = 30 * 60 * 1000;

/** What a sign-in from the card came back to do, if it was one just now. */
export function peekRememberedInviteThen(now = Date.now()): JoinThen | null {
  if (!remembered?.then || now - remembered.at > JOIN_THEN_MS) return null;
  return remembered.then;
}

/** Forgets the invite: it was joined, declined, or the member signed out. */
export function consumeRememberedInviteToken(): string | null {
  const token = remembered?.token ?? null;
  if (remembered) {
    remembered = null;
    persist();
    changed();
  }
  return token;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The remembered invite, live: re-renders when one is remembered, taken, or
 * read back from the phone after a relaunch.
 */
export function useRememberedInviteToken(): string | null {
  useEffect(() => {
    void hydrateRememberedInvite();
  }, []);
  return useSyncExternalStore(
    subscribe,
    peekRememberedInviteToken,
    peekRememberedInviteToken,
  );
}

/** Test-only: forget memory and the once-per-run read. */
export function resetRememberedInviteForTests(): void {
  remembered = null;
  hydration = null;
  changed();
}

let handledLinkUrl: string | null = null;

/**
 * The invite token in an opened link, once per link.
 *
 * `Linking.useURL()` answers with the URL that launched the app for as long as
 * the process lives, not only at the moment a link opens it. Read on every
 * visit to `/join`, an invite the member already redeemed would fill the field
 * again, and send them past s02's question (#3350), every time they came back.
 * A link that carries no token isn't marked, so a later one still counts.
 */
export function takeInviteTokenFromLink(url: string | null): string | null {
  if (!url || url === handledLinkUrl) return null;
  const token = extractInviteToken(url);
  if (token) handledLinkUrl = url;
  return token;
}

/**
 * The invite token `takeInviteTokenFromLink` would return for `url`, without
 * marking the link handled: for a render that has to know an invite is on its
 * way before the effect that applies it runs.
 */
export function peekInviteTokenFromLink(url: string | null): string | null {
  if (!url || url === handledLinkUrl) return null;
  return extractInviteToken(url);
}
