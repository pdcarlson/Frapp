"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { attachRealtimeChannel } from "@/lib/realtime/supabase-realtime";
import { chapterPresenceTopic } from "@/lib/realtime/presence-topics";
import {
  PRESENCE_HEARTBEAT_MS,
  presenceMapFrom,
  presenceStatusFor,
  sameRoster,
  type PresenceStatus,
  type RawPresenceState,
} from "@/lib/realtime/presence-status";

/**
 * Chapter-wide Realtime Presence.
 *
 * Mounted once, by `ChapterPresenceProvider` in the dashboard shell — not by
 * the screen that renders the dots. Presence has to outlive the Directory or
 * the dot would mean "has the Directory open" rather than "is online", and
 * `attachRealtimeChannel` frees an occupied topic before minting, so a second
 * subscriber on this topic would tear the first one down. See the provider for
 * the full reasoning.
 *
 * Attach and teardown are the helper's job, not this hook's: it already
 * serializes attach and release per topic, which is the #783/#817 invariant
 * `realtime-resilience` rule 1 requires every subscriber to inherit rather than
 * reimplement. This hook adds only what is presence-specific — publishing the
 * viewer, keeping that publication truthful, and reducing presence state into
 * something renderable.
 *
 * **No Postgres writes.** Presence is ephemeral per ADR-02: it lives on the
 * Realtime socket and nowhere else, so nothing here persists and a member going
 * offline leaves no row to reap.
 */

/** Events that count as "the member is still using the app". */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "focus"] as const;

/**
 * Floor on how often activity may re-publish the timestamp.
 *
 * Activity is high-frequency (every keystroke, every scroll frame) and the
 * value only feeds a 5-minute threshold, so publishing per event would burn a
 * network round trip and a re-render on every subscriber to no observable
 * effect. The worst-case error is one interval against a five-minute window.
 */
const ACTIVITY_THROTTLE_MS = PRESENCE_HEARTBEAT_MS;

export type ChapterPresence = {
  /** Status for one member. Absent from the presence map → `"offline"`. */
  statusOf: (userId: string) => PresenceStatus;
  /** False until the first `sync` for the current chapter lands. */
  isReady: boolean;
};

type Options = {
  chapterId: string | null | undefined;
  viewerId: string | null | undefined;
  enabled?: boolean;
};

const EMPTY = new Map<string, number>();

export function useChapterPresence({
  chapterId,
  viewerId,
  enabled = true,
}: Options): ChapterPresence {
  /**
   * The roster, stamped with the attach generation it was read under.
   *
   * Carrying the stamp *inside* the state is what lets a teardown be handled by
   * derivation rather than by clearing state from the effect body — a
   * synchronous `setState` there cascades renders, and React's lint rule rightly
   * refuses it. A roster whose stamp no longer matches simply stops matching
   * below, so it can never be rendered against a different attach.
   */
  const [roster, setRoster] = useState<{
    attach: number;
    byUser: Map<string, number>;
  }>(() => ({ attach: -1, byUser: EMPTY }));

  /**
   * A generation counter for "which attach are we on", bumped during render
   * whenever the inputs that mint a channel change.
   *
   * A generation is needed rather than a plain input stamp because the inputs
   * *return to a previous value*: a wifi flap takes `enabled` true→false→true
   * with the chapter unchanged, so any stamp built from the inputs alone
   * matches again on the way back, and the pre-outage roster is re-adopted as
   * current before the new channel has even joined. A counter never repeats.
   *
   * Bumped in render, not in an effect, and this is the documented React
   * pattern for adjusting state when inputs change ("You Might Not Need an
   * Effect"). It has to be render-phase: an effect runs *after* the commit, so
   * the stale roster would paint for one frame first — one frame of naming
   * people as Online who are not.
   */
  const inputs = enabled && chapterId ? `${chapterId}` : null;
  const [attachState, setAttachState] = useState({ inputs, generation: 0 });
  if (attachState.inputs !== inputs) {
    setAttachState((previous) => ({
      inputs,
      generation: previous.generation + 1,
    }));
  }

  /**
   * Whether the channel is currently delivering.
   *
   * The generation counter covers a teardown we initiated. It does *not* cover
   * a channel that simply stopped: a socket drop that never flips
   * `navigator.onLine` (a proxy dying, a server-side close, an errored re-join
   * loop) leaves `enabled` true and the chapter unchanged, so without this the
   * last roster we happened to see would render as current for the rest of the
   * session — naming people Online who left hours ago. A quiet channel and a
   * dead one are indistinguishable from the inside, which is why the transport
   * has to say so.
   */
  const [connected, setConnected] = useState(false);

  const isCurrent =
    inputs !== null &&
    connected &&
    roster.attach === attachState.generation;
  const presentSince = isCurrent ? roster.byUser : EMPTY;

  /**
   * `viewerId` is deliberately not an effect dependency.
   *
   * It resolves from `/v1/users/me` after first paint, so keying the channel on
   * it would attach `presence:chapter:<id>`, tear it down, and re-attach as
   * soon as the profile landed — two joins per cold load, and a spurious
   * leave/join observed by every other member. `use-realtime-table.ts` keeps
   * non-topic values in a ref for exactly this reason; the ref is read at
   * publish time, so a late-resolving id is picked up without re-minting.
   *
   * Written in `useLayoutEffect`, not during render (`react-hooks/refs`), and
   * for the same reason `use-realtime-table.ts` does it there. Layout effects
   * run before passive ones in the same commit, so the attach effect below
   * always reads the current value.
   */
  const viewerIdRef = useRef(viewerId);
  useLayoutEffect(() => {
    viewerIdRef.current = viewerId;
  }, [viewerId]);

  /**
   * The live attach's publish function, so a late-resolving `viewerId` can be
   * published without re-minting the channel.
   *
   * Keeping `viewerId` out of the channel's deps is only half the job. On a
   * cold load the id is `null` when the channel joins, so the `onSubscribed`
   * publish no-ops — and nothing else fires afterwards, because the effect does
   * not re-run and SUBSCRIBED does not repeat. The member would sit unpublished
   * until they happened to touch the page, and a member who opens the app and
   * only reads would never appear online at all.
   */
  const publishRef = useRef<(() => void) | null>(null);

  // Re-render on a wall-clock tick so a member who stops interacting crosses
  // into Idle on their own. Nothing is broadcast when someone merely stops
  // typing, so without a local tick the row would keep reading Online until
  // some unrelated sync arrived.
  //
  // Gated on there being someone to age: with an empty roster no dot renders at
  // all, and ticking would re-render the whole directory every 30s forever to
  // change nothing.
  //
  // The clock is held as state rather than read at call time, so the
  // dependency is real rather than a lint appeasement: `statusOf` closes over
  // `now`, its identity changes when `now` does, and the returned object is
  // memoized on it. Reading `Date.now()` inside `statusOf` instead would make
  // the Idle transition travel only on the return object being freshly
  // allocated every render — which defeats the `sameRoster` bailout at the
  // context boundary, and would stop working entirely the moment anyone
  // memoized the return (the React Compiler would do exactly that).
  const [now, setNow] = useState(() => Date.now());
  const hasRoster = presentSince.size > 0;
  useEffect(() => {
    if (!hasRoster) return undefined;
    const interval = setInterval(
      () => setNow(Date.now()),
      PRESENCE_HEARTBEAT_MS,
    );
    return () => clearInterval(interval);
  }, [hasRoster]);

  // The generation this attach belongs to. React re-renders before committing
  // effects when a render-phase update fires, so the effect always sees the
  // generation its own inputs produced.
  const generation = attachState.generation;

  useEffect(() => {
    if (!enabled || !chapterId) return undefined;

    const topic = chapterPresenceTopic(chapterId);
    let channel: RealtimeChannel | null = null;
    let detached = false;
    // Last activity published for the viewer. Seeded now: a member who opens
    // the app and reads without touching anything is active, not idle.
    let lastActiveAt = Date.now();
    let lastPublishedAt = 0;

    function readState() {
      if (!channel || detached) return;
      const next = presenceMapFrom(
        channel.presenceState() as unknown as RawPresenceState,
      );
      setRoster((previous) =>
        // A re-publish of an unchanged payload broadcasts a diff to every
        // subscriber. Without this, each peer's activity re-publish would
        // replace the roster with a structurally identical Map and re-render
        // the whole directory — search box, sorts, every row — to change
        // nothing on screen.
        previous.attach === generation && sameRoster(previous.byUser, next)
          ? previous
          : { attach: generation, byUser: next },
      );
    }

    function publish() {
      const id = viewerIdRef.current;
      if (!channel || !id || detached) return;
      lastPublishedAt = Date.now();
      // Fire-and-forget, as chat's own track is. `RealtimeChannel.send`
      // resolves `'ok' | 'error' | 'timed out'` rather than rejecting once
      // joined, and the cost of a lost publish is one member's dot until the
      // next activity.
      void channel.track({ userId: id, ts: lastActiveAt });
    }

    function onActivity() {
      // `visibilitychange` fires in both directions. Stamping on *hide* would
      // reset the idle clock at the moment the member walks away, so someone
      // who alt-tabs 10s before crossing into Idle would read Online for a
      // further five minutes.
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      lastActiveAt = now;
      if (now - lastPublishedAt < ACTIVITY_THROTTLE_MS) return;
      publish();
    }

    const detach = attachRealtimeChannel(
      topic,
      (realtimeChannel) => {
        channel = realtimeChannel;
        // Bound before `subscribe()` deliberately: realtime-js decides whether
        // to enable presence from the bindings present at subscribe time.
        realtimeChannel.on("presence", { event: "sync" }, readState);
        realtimeChannel.on("presence", { event: "join" }, readState);
        realtimeChannel.on("presence", { event: "leave" }, readState);
        return realtimeChannel;
      },
      {
        // The only moment a publish is both possible and meaningful. The
        // channel is minted on a microtask, so the effect body cannot reach it;
        // and `configure` runs before the join, where a push throws. This fires
        // again on every reconnect, which is what re-publishes the viewer after
        // a drop — without it a member vanishes from the map for the rest of
        // the session. Chat's manager re-tracks on each SUBSCRIBED for the same
        // reason.
        onSubscribed: () => {
          setConnected(true);
          publish();
        },
        // The roster stops being evidence the moment the channel does.
        onDisconnected: () => setConnected(false),
      },
    );

    publishRef.current = publish;

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onActivity);

    return () => {
      detached = true;
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }
      document.removeEventListener("visibilitychange", onActivity);
      channel = null;
      publishRef.current = null;
      setConnected(false);
      detach();
    };
  }, [enabled, chapterId, generation]);

  // Declared after the attach effect so `publishRef` is already set on mount.
  // On mount this no-ops (the channel has not joined yet, and `onSubscribed`
  // covers that moment); its job is the *later* transition, when the profile
  // resolves against a channel that is already live.
  useEffect(() => {
    if (viewerId) publishRef.current?.();
  }, [viewerId]);

  // `now` advances on the interval above, which is what carries a member from
  // Online into Idle when nothing at all arrives on the wire.
  const statusOf = useCallback(
    (userId: string) => presenceStatusFor(presentSince.get(userId), now),
    [presentSince, now],
  );

  // Memoized so an unchanged roster does not re-render every context consumer.
  // Safe precisely because `statusOf` above carries the clock — otherwise this
  // would freeze presence at whatever it was when the roster last changed.
  return useMemo(
    () => ({ statusOf, isReady: isCurrent }),
    [statusOf, isCurrent],
  );
}
