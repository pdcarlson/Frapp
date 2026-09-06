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
    connection: number;
    byUser: Map<string, number>;
  }>(() => ({ connection: -1, byUser: EMPTY }));

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
   * The live connection — which attach it belongs to, and a globally unique id
   * for this particular join — or `null` when nothing is delivering.
   *
   * Two things forced this to be an identity rather than a boolean, and each
   * was a real defect:
   *
   *   1. *A boolean cannot tell a rejoin's roster from the pre-drop one.* A
   *      socket drop leaves `enabled` and the chapter unchanged, so the
   *      generation never moves; clearing a flag hides the stale roster, but
   *      the flag goes true again on the join reply — which arrives strictly
   *      *before* the server's `presence_state` — so the pre-drop roster was
   *      republished as current in the gap. A laptop waking after two hours
   *      showed everyone who had been online two hours ago. Stamping the roster
   *      with the connection it was read on closes that: a new join is a new
   *      id, so the old roster simply stops matching until a fresh sync lands.
   *   2. *A shared boolean lets a dead channel silence a live one.* Release and
   *      attach are queued under different topics, so they run concurrently on
   *      a chapter switch, and the old channel's `CLOSED` can land after the
   *      new one has joined. An ungated `setConnected(false)` there turned
   *      presence off for the rest of the session — no dots at all in the new
   *      chapter, with nothing to re-enable it. Carrying the generation lets a
   *      late callback recognise that it is no longer the live attach.
   */
  const [live, setLive] = useState<{
    generation: number;
    attachId: number;
    connection: number;
  } | null>(null);

  /** Monotonic, so a rejoin is never mistaken for the connection it replaced. */
  const connectionSeq = useRef(0);

  /**
   * Identifies one *run of the attach effect*, which the generation cannot.
   *
   * The generation only moves when the inputs change, so two attaches can share
   * one: StrictMode (on by default in dev) mounts, tears down and re-mounts
   * every effect with the inputs untouched. The replaced attach's late `CLOSED`
   * would then pass a generation-only guard and clear the live connection its
   * own successor had just established — presence silently dead in development,
   * intermittently, which is the worst place to spend debugging time. The
   * generation stays for the render-visible comparison; this is the exact
   * identity the late callbacks check.
   */
  const attachSeq = useRef(0);

  /**
   * Last user activity, and when it was last published.
   *
   * Refs rather than effect-locals, because a re-attach must not invent
   * activity. As effect-locals these were re-seeded to `Date.now()` on every
   * run of the attach effect — and `enabled` comes from `navigator.onLine`, so
   * a two-second wifi blip or a laptop waking from sleep re-runs it with no
   * user interaction whatsoever. A member who had been idle for ten minutes was
   * republished as freshly active and flipped back to Online on every other
   * member's screen, for another five minutes. Idle was effectively unreachable
   * for anyone whose connection ever wobbled.
   *
   * The seeding intent still holds for the *first* attach, which is what the
   * `null` sentinel is for: someone who opens the app and only reads is active,
   * not idle. It is seeded there rather than here because `Date.now()` is
   * impure and must not be called during render.
   */
  const lastActiveAtRef = useRef<number | null>(null);
  const lastPublishedAtRef = useRef(0);

  const isCurrent =
    inputs !== null &&
    live !== null &&
    live.generation === attachState.generation &&
    roster.connection === live.connection;
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
    // The join this attach is currently on. `-1` until the first SUBSCRIBED,
    // which is a value no `live` connection ever takes — so a presence frame
    // arriving before the join reply could not be adopted as current.
    let connectionId = -1;
    attachSeq.current += 1;
    const attachId = attachSeq.current;
    // First attach only — a re-attach must never invent activity.
    lastActiveAtRef.current ??= Date.now();

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
        previous.connection === connectionId && sameRoster(previous.byUser, next)
          ? previous
          : { connection: connectionId, byUser: next },
      );
      // The Idle clock only ticks while there is a roster to age, so it freezes
      // whenever the roster is empty or the channel is down — for as long as
      // that lasts. Re-reading it here is what keeps a resumed roster from
      // being judged against a clock from before the gap: a member who has
      // genuinely been inactive for six minutes would otherwise read Online,
      // because a ten-minute-stale `now` puts their timestamp in the future.
      //
      // Moved only once it has drifted by a whole interval, though. Presence
      // frames are frequent, and advancing the clock on each one would change
      // `statusOf`'s identity every time — re-rendering the whole directory and
      // undoing the `sameRoster` bailout immediately above it.
      setNow((previous) => {
        const current = Date.now();
        return current - previous >= PRESENCE_HEARTBEAT_MS ? current : previous;
      });
    }

    function publish() {
      const id = viewerIdRef.current;
      if (!channel || !id || detached) return;
      lastPublishedAtRef.current = Date.now();
      // Fire-and-forget, as chat's own track is. `RealtimeChannel.send`
      // resolves `'ok' | 'error' | 'timed out'` rather than rejecting once
      // joined, and the cost of a lost publish is one member's dot until the
      // next activity.
      void channel.track({
        userId: id,
        ts: lastActiveAtRef.current ?? Date.now(),
      });
    }

    function onActivity() {
      // `visibilitychange` fires in both directions. Stamping on *hide* would
      // reset the idle clock at the moment the member walks away, so someone
      // who alt-tabs 10s before crossing into Idle would read Online for a
      // further five minutes.
      if (document.visibilityState !== "visible") return;
      const current = Date.now();
      lastActiveAtRef.current = current;
      if (current - lastPublishedAtRef.current < ACTIVITY_THROTTLE_MS) return;
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
        // Private since #1552 (phase 1): the join and every `track()` are
        // authorised by `realtime_messages_scoped_select` / `_insert` on
        // `realtime.messages` (migration 20260906203000), behind the chapter-
        // membership predicate. Without those branches a private topic joins,
        // reports SUBSCRIBED and delivers nothing — which is why the flag and
        // the migration shipped together and this comment names the file.
        private: true,
        // The only moment a publish is both possible and meaningful. The
        // channel is minted on a microtask, so the effect body cannot reach it;
        // and `configure` runs before the join, where a push throws. This fires
        // again on every reconnect, which is what re-publishes the viewer after
        // a drop — without it a member vanishes from the map for the rest of
        // the session. Chat's manager re-tracks on each SUBSCRIBED for the same
        // reason.
        onSubscribed: () => {
          // Symmetric with `readState` and `publish`. The helper already
          // refuses to mint a detached attach, so this is defence in depth
          // rather than a live path — but an unguarded SUBSCRIBED would
          // overwrite `live` with a replaced attach's connection exactly as an
          // unguarded CLOSED used to clear it, and leaving one of the three
          // late callbacks asymmetric is how that class of bug comes back.
          if (detached) return;
          connectionSeq.current += 1;
          connectionId = connectionSeq.current;
          setLive({ generation, attachId, connection: connectionId });
          publish();
        },
        // The roster stops being evidence the moment the channel does — but
        // only this attach's roster. A late `CLOSED` from a channel we already
        // replaced must not clear the one that succeeded it.
        onDisconnected: () =>
          setLive((previous) =>
            previous?.attachId === attachId ? null : previous,
          ),
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
      // Same guard as `onDisconnected`: clear only if this attach is still the
      // live one.
      setLive((previous) =>
        previous?.attachId === attachId ? null : previous,
      );
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
