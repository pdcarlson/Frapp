"use client";

/**
 * The composer's unsent text for one channel: in memory, in Dexie, and across
 * the moment the channel itself arrives.
 *
 * Split out of `use-chat-channel.ts` by #2176. It was four lines of `useState`
 * there and did not need a home of its own; the composer shell made it a small
 * state machine with a race in it, and `useChatChannel` takes eight
 * dependencies (a query client, the API client, auth, toasts, analytics, the
 * realtime singleton) that a test of *this* would have to stand up for no
 * reason. Everything here is reachable from a channel id and two Dexie calls.
 *
 * ## The ordering this exists to get right
 *
 * `1s` budgets "composer focusable <= 400ms" and `ComposerShell` meets it by
 * rendering before `GET /v1/channels` resolves — which means the member can be
 * typing while `channelId` is still `null`. Three things then have to line up:
 *
 * 1. Text typed with no channel is still kept (`setDraft` stores either way).
 * 2. It becomes the new channel's draft the instant one arrives — not a render
 *    later, because the render that supplies the channel id is the same one
 *    that mounts `<Composer>`, and `useEditor` builds its document once.
 * 3. The Dexie restore for that channel must not then overwrite it. It is
 *    asynchronous and it usually answers with the empty string, so without a
 *    guard the member watches their own sentence disappear a few milliseconds
 *    after the page finishes loading.
 *
 * (1) is why `setDraft` has no channel guard around `setDraftState`, (2) is why
 * `draft` is *masked* rather than cleared while there is no channel, and (3) is
 * `typedFor`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clearDraft, loadDraft, saveDraft } from "./offline-queue";
import { useChatOutboundScope } from "./chat-scope";

/** How long typing settles before it is written to Dexie. */
const SAVE_DEBOUNCE_MS = 400;

export interface ChannelDraft {
  /** The composer's current text. Empty while there is no channel to own it. */
  draft: string;
  /** Record what the member has typed, with or without a channel. */
  setDraft: (body: string) => void;
  /**
   * Drop a debounced save that has not fired yet.
   *
   * Called before a send, so a write scheduled from the last keystroke cannot
   * land after the send has cleared the draft and restore text that was posted.
   */
  cancelPendingSave: () => void;
  /** Forget the draft once a send has committed — memory and Dexie. */
  clearAfterSend: () => Promise<void>;
}

export function useChannelDraft(channelId: string | null): ChannelDraft {
  const [draftState, setDraftState] = useState("");
  /*
    Whose drafts these are (#2226). A draft row's primary key is
    `[userId+channelId]`, so without a resolved scope there is no key to read or
    write one under — and inventing one is exactly the cross-account bug the
    scope exists to close.

    Treated like a not-yet-known `channelId` throughout, because it behaves like
    one: the text still lands in `draftState` and the composer is still usable,
    only the Dexie half waits. The wait is short — `useAuthUserId` resolves from
    the stored session and the chapter store is persisted — and a member typing
    inside it loses nothing, because the effect below runs the moment the scope
    arrives and settles what they typed against whatever was saved, the same way
    it already does for text typed before a channel existed.
  */
  const scope = useChatOutboundScope();

  /**
   * The channel the member has typed into during this session, if any.
   *
   * A channel id rather than a boolean, because the answer is per channel: on a
   * switch the outgoing channel's id no longer matches, so the incoming
   * channel's persisted draft applies normally.
   */
  const typedFor = useRef<string | null>(null);
  /**
   * The member typed into the composer shell before any channel existed.
   *
   * Separate from `typedFor` rather than a sentinel value in it, because it is
   * a genuinely different state: "this text belongs to whichever channel we
   * land in" rather than "this text belongs to channel X". It is claimed by the
   * first channel id to arrive and is never true again.
   */
  const typedBeforeChannel = useRef(false);
  /**
   * A mirror of `draftState` that callbacks can read.
   *
   * The restore below has to settle two texts against each other from inside a
   * promise, and a promise created in an effect closes over the render that
   * created it. It must emphatically **not** read the shell's last keystroke:
   * by the time Dexie answers, the editor has mounted and the member may have
   * kept typing into it for a hundred milliseconds, and settling against the
   * older value would throw all of that away and move their caret.
   */
  const latest = useRef("");
  /**
   * Bumped whenever something invalidates an in-flight Dexie restore.
   *
   * A send is the case that matters — and the *only* one. `loadDraft` is
   * asynchronous (the first `getChatDB()` opens IndexedDB, routinely tens of
   * milliseconds on a cold load) and the composer is usable before it answers,
   * which is the whole point of the shell. A member who types and presses Enter
   * straight away gets their message posted and the draft cleared, and then the
   * restore lands and puts the text they just sent back into the composer,
   * persisted. Comparing the epoch is how the restore learns it is answering a
   * question nobody is asking any more.
   *
   * Deliberately not bumped by `cancelPendingSave`, which `setDraft` calls on
   * every keystroke: doing that made the first character typed after the
   * handoff cancel the restore, so the saved draft the settle below exists to
   * preserve was dropped and then overwritten by the next debounced write.
   */
  const restoreEpoch = useRef(0);

  useEffect(() => {
    if (!channelId || !scope) return;
    /*
      Claim the shell's text for this channel synchronously, before the
      asynchronous restore below can race it. The text is already in
      `draftState`; all that is missing is the record of whose it is.
    */
    const claimedFromShell = typedBeforeChannel.current;
    if (claimedFromShell) {
      typedBeforeChannel.current = false;
      typedFor.current = channelId;
    }
    let cancelled = false;
    const epoch = restoreEpoch.current;
    loadDraft(scope, channelId)
      .then((body) => {
        if (cancelled) return;
        // A send (or an explicit cancel) happened while this was in flight;
        // whatever was on disk when it started is no longer what the composer
        // should show.
        if (restoreEpoch.current !== epoch) return;
        /*
          A persisted draft never overwrites text the member has already typed
          for this same channel.

          Note this is not #1497, which is the reverse: `draftState` still
          holding the *outgoing* channel's text across a switch. That case has a
          different id in `typedFor` and is deliberately left alone here.
        */
        if (typedFor.current !== channelId) {
          latest.current = body;
          setDraftState(body);
          return;
        }
        if (!claimedFromShell) return;
        /*
          Settle the shell's text against whatever was saved — and then persist
          the result, which is the only moment it is safe to.

          Two things would otherwise be destroyed here, quietly.

          One: a saved draft the member was never shown. The shell cannot
          display one, because it does not know the channel yet — so a member
          returning to a half-written message sees an empty-looking composer,
          types one character while the list loads, and that character replaces
          yesterday's paragraph. Neither text can be dropped, so neither is: the
          saved draft is restored and what they just typed follows it.
          Surprising is a fair criticism of that; losing one of them silently is
          not a trade this can make.

          Two: the shell's own text, on a channel the member cannot post in.
          `setDraft` schedules no write while `channelId` is null, and if the
          resolved channel comes back `can_post: false` there is no editor to
          fire another keystroke — so the text lives only in memory and the next
          channel switch drops it. Writing it here gives it the same durability
          it would have had if it had been typed a second later.

          The write waits until now on purpose: `loadDraft` is still in flight
          above, and saving at claim time would overwrite the very draft this is
          trying not to lose.
        */
        const typed = latest.current;
        const settled =
          body && typed && typed !== body ? `${body}\n${typed}` : typed || body;
        // Re-rendering for an unchanged value is waste, but the write below is
        // not conditional on it: the common shell handoff settles to exactly
        // what is already on screen and is precisely the case that still has
        // nothing on disk.
        if (settled !== typed) {
          latest.current = settled;
          setDraftState(settled);
        }
        if (settled && settled !== body) {
          void saveDraft(scope, channelId, settled).catch(() => {
            // Best-effort, exactly like every other write here: a draft that
            // could not be persisted is not worth breaking the channel for.
          });
        }
      })
      .catch((err) => {
        // IndexedDB read can throw in private mode / quota issues — degrade to
        // an empty draft rather than crash the channel.
        console.warn("loadDraft failed", err);
      });
    return () => {
      cancelled = true;
      /*
        The claim is void the moment we leave the channel, and forgetting this
        is worse than never having guarded at all.

        `typedFor` means "the member typed this text, for this channel, during
        this session". Once `channelId` changes, `draftState` belongs to
        whatever channel comes next — so a stale claim would suppress the
        restore on the way *back*. Type in `#general`, visit `#random`, return:
        `loadDraft("general")` would resolve with the real draft and be
        discarded because `typedFor` still said "general", leaving `#random`'s
        text sitting in `#general`'s composer, ready to be sent there.
      */
      typedFor.current = null;
    };
  }, [channelId, scope]);

  /*
    Masked, not cleared. `setDraftState` above runs with or without a channel,
    so what the member typed into `ComposerShell` is already held here and
    becomes `draft` on the very render that supplies the channel id — which is
    the render that mounts `<Composer>`. That is the whole shell-to-editor
    handoff: no seed prop, and nothing to correct after the editor is built.
  */
  const draft = channelId ? draftState : "";

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const setDraft = useCallback(
    (body: string) => {
      latest.current = body;
      setDraftState(body);
      if (!channelId || !scope) {
        // The composer shell, mid cold load. There is nothing to attribute the
        // text to yet and nothing to persist it under; the effect above claims
        // it the moment a channel — and a scope — arrives.
        typedBeforeChannel.current = true;
        return;
      }
      typedFor.current = channelId;
      cancelPendingSave();
      saveTimer.current = setTimeout(() => {
        // `.catch` and not a bare `void`: `db.drafts.put` rejects under storage
        // pressure and in Safari's private mode, and an unhandled rejection
        // here reaches Sentry as an unhandled error once per typing burst,
        // carrying no channel context and describing nothing anyone can act on.
        void saveDraft(scope, channelId, body).catch(() => {
          // Best-effort. The draft is still in memory; losing the write is not
          // worth an error report.
        });
      }, SAVE_DEBOUNCE_MS);

    },
    [channelId, scope, cancelPendingSave],
  );

  const clearAfterSend = useCallback(async () => {
    restoreEpoch.current += 1;
    typedBeforeChannel.current = false;
    latest.current = "";
    setDraftState("");
    if (!channelId || !scope) return;
    // Same Dexie drafts table `sendMessage` already cleared best-effort. A
    // second fault must not reject a send that already posted (#1718).
    try {
      await clearDraft(scope, channelId);
    } catch {
      // Best-effort — in-flight saveDraft races are why this call exists.
    }
  }, [channelId, scope]);

  return { draft, setDraft, cancelPendingSave, clearAfterSend };
}
