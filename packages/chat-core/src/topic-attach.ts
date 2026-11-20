/**
 * Attach and release for a Supabase Realtime topic, serialized per topic.
 *
 * Moved here from `apps/web/lib/realtime/supabase-realtime.ts` (#3929) so
 * mobile's change-ping subscription and web's `useRealtimeTable` share one
 * implementation, as they already share `topic-registry.ts`
 * (realtime-resilience rule 1). Web binds its own client in
 * `attachRealtimeChannel`; the code below is unchanged apart from taking the
 * client as an argument.
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  isJoinDenied,
  onAccessTokenChange,
  REFUSAL_CONFIRM_MS,
} from "./join-denied";
import { isTopicOccupied, releaseTopic } from "./topic-registry";

/**
 * Serializes every attach and release for a given topic.
 *
 * Freeing a topic is asynchronous (`unsubscribe()` before `teardown()`) but a
 * `useEffect` cleanup is synchronous, so an effect re-run hands us a release
 * and the next attach in the same tick. Running those concurrently is its own
 * bug: the release would iterate the registry *after* the successor had already
 * minted its channel on that topic and tear the live one down. Chaining them
 * per topic makes the ordering the obvious one — a release always completes
 * before the attach queued behind it starts.
 *
 * Keyed by bare topic, so unrelated topics never wait on each other.
 */
const topicOperations = new Map<string, Promise<void>>();

function enqueue(topic: string, operation: () => Promise<void>): Promise<void> {
  const previous = topicOperations.get(topic) ?? Promise.resolve();
  // `previous` is already terminated with a `catch`, so it never rejects and a
  // failed operation cannot stall the ones queued behind it.
  const next = previous.then(operation).catch((error: unknown) => {
    // Contained deliberately: every caller is a React effect, and a rejection
    // escaping into a commit phase is exactly how #783 unmounted the shell.
    // Logged rather than swallowed because the alternative failure is silent —
    // a subscription that never attaches looks identical to an idle one.
    console.warn(`realtime: topic "${topic}" operation failed`, error);
  });
  topicOperations.set(topic, next);
  void next.then(() => {
    // Drop the entry once it is settled and still the tail, so a long-lived
    // session does not accumulate one promise per topic it ever visited.
    if (topicOperations.get(topic) === next) topicOperations.delete(topic);
  });
  return next;
}

export type TopicAttachOptions = {
  private?: boolean;
  /**
   * Called with the channel every time it reaches `SUBSCRIBED` — the initial
   * join and every reconnect.
   *
   * This exists because a caller cannot reach that moment on its own. The
   * channel is minted inside the topic queue below, which runs on a
   * microtask, so a caller's code after `attachRealtimeChannel(...)` returns
   * still sees no channel; and `configure` runs *before* `subscribe()`, where
   * a `push` throws `tried to push before joining`. Presence tracking needs
   * exactly this seam: `track()` is only meaningful once joined, and must be
   * re-sent after a reconnect or the member silently vanishes from the
   * presence map for the rest of the session.
   */
  onSubscribed?: (channel: RealtimeChannel) => void;
  /**
   * Called when the channel stops delivering — `CHANNEL_ERROR`, `TIMED_OUT`
   * or `CLOSED`. A join Realtime refused because the member may not read the
   * topic reports `CHANNEL_ERROR` here too, and once the refusals have gone
   * on for `REFUSAL_CONFIRM_MS` the channel is let go rather than left to
   * rejoin (#5765).
   *
   * The counterpart to `onSubscribed`, and it exists because the silent
   * version of this is dangerous: a dropped channel that never re-joins looks
   * exactly like a quiet one. A subscriber holding derived state read off the
   * channel needs to know it has stopped being current, rather than keep
   * rendering the last thing it saw as fact.
   */
  onDisconnected?: (status: string) => void;
};

/**
 * Wraps `client.channel(topic).subscribe()` with a consistent unsubscribe
 * path. Call from a `useEffect` and return the cleanup it hands back.
 *
 * The channel is minted on the topic queue rather than inline, so an effect
 * re-run on an *unchanged* topic (a new `queryClient`, a React StrictMode
 * remount) cannot get the previous, already subscribed instance back and
 * throw out of `configure()` (#817).
 */
export function attachTopicChannel(
  client: SupabaseClient,
  topic: string,
  configure: (channel: RealtimeChannel) => RealtimeChannel,
  options: TopicAttachOptions = {},
): () => void {
  let detached = false;
  let attached: RealtimeChannel | null = null;
  /** Ends the wait for a new token after a refused join, if one is armed. */
  let stopAuthWait = () => {};
  /**
   * When Realtime first refused this topic since it last let a join through,
   * and whether the refusal has since counted as final (#5765). They outlive
   * any one channel instance: the attach after a new token is still the same
   * question, and a refusal there is final at once.
   */
  let firstRefusedAt: number | null = null;
  let givenUp = false;

  /*
    A refused join (#5765): the member may not read this topic. Phoenix would
    ask again on its own timer (1, 2, 5, then every 10 s) for as long as the
    channel stays registered, so once the refusals have gone on for
    `REFUSAL_CONFIRM_MS` the channel is released, and the topic is asked for
    again once, when the session's token becomes a different one
    (`onAccessTokenChange`): a new token can carry access the old one didn't,
    or belong to another member. Unmounting cancels the wait; a remount asks
    afresh.
  */
  const waitForNewToken = () => {
    stopAuthWait();
    const stop = onAccessTokenChange(client, () => {
      stop();
      stopAuthWait = () => {};
      if (!detached) void enqueue(topic, attach);
    });
    stopAuthWait = stop;
  };

  /** True when this refusal is final (see `REFUSAL_CONFIRM_MS`). */
  const refusalHolds = (): boolean => {
    if (givenUp) return true;
    const now = Date.now();
    firstRefusedAt ??= now;
    givenUp = now - firstRefusedAt >= REFUSAL_CONFIRM_MS;
    return givenUp;
  };

  async function attach(): Promise<void> {
    if (detached) return;
    if (isTopicOccupied(client, topic)) {
      await releaseTopic(client, topic);
      // Cleanup can land while the release is in flight; the queued release
      // below would then have nothing to undo, so stop here instead.
      if (detached) return;
    }
    // `private: true` routes the subscription through `realtime.messages` RLS,
    // which is what authorises the scoped change topics (see
    // `change-topics.ts`). A public channel on those topics would hand every
    // ping to anyone who guessed the string, so this flag is a security
    // control, not a tuning knob. The JWT it authorises against is put on the
    // socket by supabase-js itself — it calls `realtime.setAuth()` on init and
    // on every auth transition — so there is nothing to wire here.
    const channel = options.private
      ? client.channel(topic, { config: { private: true } })
      : client.channel(topic);
    // Claim it for cleanup *before* `configure` runs: the channel is already in
    // the client's registry by now, so a `configure` that throws would
    // otherwise strand it there with nothing holding a reference to release.
    attached = channel;
    configure(channel);
    // Observe the join result. `private: true` introduces an authorization step
    // that can DENY, and a denied channel is otherwise completely silent:
    // phoenix flips to `errored` and re-joins on a backoff loop for the rest of
    // the session with nothing logged and nothing shown. A denial is therefore
    // logged and the channel let go (#5765), below.
    //
    // That is the same "joins, reports SUBSCRIBED, never fires" shape that hid
    // the empty-publication bug (#867) for months, so it gets a log line rather
    // than a comment. The concrete case: `activeChapterId` is persisted to
    // localStorage, so a member removed from a chapter still asks for
    // `events:<that chapter>` on their next login, and until #5765 was
    // denied forever.
    // Set once the join is refused for good and the channel let go: its own
    // teardown, or a rejoin phoenix already had in flight, can still report
    // after that.
    let refused = false;
    channel.subscribe((status, error) => {
      if (refused) return;
      if (status === "SUBSCRIBED") {
        firstRefusedAt = null;
        givenUp = false;
        // Contained: this runs inside a library callback, so a throw here has
        // no owner and would surface as an unhandled error mid-commit.
        try {
          options.onSubscribed?.(channel);
        } catch (error) {
          console.warn(`realtime: topic "${topic}" onSubscribed failed`, error);
        }
        return;
      }
      if (status === "CHANNEL_ERROR" && isJoinDenied(error) && refusalHolds()) {
        refused = true;
        console.warn(
          `realtime: topic "${topic}" join refused; not asking again until the session's token changes`,
        );
        try {
          options.onDisconnected?.(status);
        } catch (failure) {
          console.warn(
            `realtime: topic "${topic}" onDisconnected failed`,
            failure,
          );
        }
        void enqueue(topic, async () => {
          if (attached !== channel) return;
          attached = null;
          await releaseTopic(client, topic);
        });
        if (!detached) waitForNewToken();
        return;
      }
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        // CLOSED is not warned: it is the ordinary end of a teardown, unlike
        // the two failures.
        if (status !== "CLOSED") {
          console.warn(`realtime: topic "${topic}" join ${status}`);
        }
        try {
          options.onDisconnected?.(status);
        } catch (error) {
          console.warn(
            `realtime: topic "${topic}" onDisconnected failed`,
            error,
          );
        }
      }
    });
  }

  void enqueue(topic, attach);

  return () => {
    detached = true;
    stopAuthWait();
    void enqueue(topic, async () => {
      // Null when the attach never ran (cleanup overtook it) or already
      // released — either way there is nothing registered to free.
      if (!attached) return;
      attached = null;
      await releaseTopic(client, topic);
    });
  };
}
