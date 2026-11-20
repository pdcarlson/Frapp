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
 * What a thread says in place of its timeline once its channel can't be read
 * any more, on web and the phone alike (`spec/ui/design-system/writing.md`
 * § Chat (dashboard)). It states what happened; it doesn't tell the member
 * what to do, since the way out (Browse channels on web, Back on the phone)
 * sits right there.
 */
export const CHANNEL_UNAVAILABLE_TITLE = "This channel is no longer available";
export const CHANNEL_UNAVAILABLE_BODY =
  "It was deleted, or you can no longer see it.";
