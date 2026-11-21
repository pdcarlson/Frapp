import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A Realtime join the server refused because the member may not read the
 * topic, told apart from a join that failed for a reason that passes (#5765).
 *
 * A private channel's join is authorised by the `realtime_messages_scoped_*`
 * policies on `realtime.messages`. When they say no, Realtime answers the join
 * with an error whose reason reads
 * `Unauthorized: You do not have permissions to read from this Channel topic: <topic>`,
 * and realtime-js hands it to the subscribe callback as `CHANNEL_ERROR` with
 * that reason as the error's message (and `{ reason }` as its `cause`).
 *
 * That answer doesn't change on its own: the channel was deleted, or the
 * member's access was taken away. Phoenix still rejoins an errored channel on
 * its own timer (1, 2, 5, then every 10 s) for as long as the socket is up, so
 * a client that leaves such a channel registered asks forever. On staging on
 * 2026-11-20 one phone asked about 385 times in 80 minutes for a channel that
 * had been deleted while it was open, every attempt one more RLS check.
 *
 * Only an authorisation refusal counts. A timeout, a dropped socket, a
 * `postgres_changes` stream that couldn't start (`PostgresChangesSubscribeTimeout`)
 * and anything else stay transient and keep their backoff.
 */
const DENIED = /\bunauthori[sz]ed\b|do not have permissions? to read/i;

export function isJoinDenied(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return DENIED.test(error);
  if (typeof error !== "object") return false;
  const { message, cause, reason } = error as {
    message?: unknown;
    cause?: unknown;
    reason?: unknown;
  };
  if (typeof message === "string" && DENIED.test(message)) return true;
  if (typeof reason === "string" && DENIED.test(reason)) return true;
  // realtime-js keeps the server's reply as the error's `cause`.
  if (cause && cause !== error) return isJoinDenied(cause);
  return false;
}

/**
 * How long a topic must go on being refused before the refusal counts (#5765).
 *
 * A join can be refused for a moment that passes: one sent before realtime-js
 * has the member's token (a cold start whose stored token has to be refreshed
 * first) is checked as nobody and refused, and its next attempt, a second
 * later, goes through. So the first refusal is handled like any failed join,
 * and only a refusal still coming back this long after it gives the topic up.
 * Phoenix's rejoins (1, 2, 5 s) and the chat backoff (1, 2, 4 s) both get
 * several attempts in, so a deleted channel stops after about 8 s.
 */
export const REFUSAL_CONFIRM_MS = 5_000;

/**
 * How long after the session's token changes a given-up topic is asked for
 * again: supabase-js hands Realtime the new token from its own auth listener,
 * asynchronously, so the rejoin waits for that rather than going out on the
 * old one.
 */
export const RETRY_AFTER_TOKEN_MS = 1_000;

/**
 * Calls `onChange` (after {@link RETRY_AFTER_TOKEN_MS}) each time the session's
 * access token becomes a different one: a refresh, or another member signing
 * in. Read from the token, not the event: auth-js also announces `SIGNED_IN`
 * for an unchanged session whenever a web tab comes back into view, and that
 * is no reason to ask again. `INITIAL_SESSION`, which every new listener is
 * handed at once, sets the token it compares against.
 *
 * Returns the unsubscribe, which also cancels a call still waiting. A client
 * without auth (a test double) gets a no-op.
 */
export function onAccessTokenChange(
  client: SupabaseClient,
  onChange: () => void,
): () => void {
  const auth = (client as Partial<SupabaseClient>).auth;
  if (!auth?.onAuthStateChange) return () => {};
  let last: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};
  try {
    const { data } = auth.onAuthStateChange((event, session) => {
      const token = session?.access_token ?? null;
      const changed =
        event !== "INITIAL_SESSION" && token !== null && token !== last;
      last = token;
      if (!changed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, RETRY_AFTER_TOKEN_MS);
    });
    unsubscribe = () => data.subscription.unsubscribe();
  } catch {
    // Nothing to listen to: what was given up waits for the next open.
  }
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    try {
      unsubscribe();
    } catch {
      // Already gone.
    }
  };
}

/**
 * What a thread says in place of its timeline once its channel can't be read
 * any more, on web and the phone alike (`spec/ui/design-system/writing.md`
 * § Chat (dashboard)). It states what happened; it doesn't tell the member
 * what to do, since the way out (Browse channels on web, Back on the phone)
 * sits right there.
 */
export const CHANNEL_UNAVAILABLE_TITLE = "This channel is no longer available";
export const CHANNEL_UNAVAILABLE_BODY =
  "It was deleted, or you can no longer see it.";
