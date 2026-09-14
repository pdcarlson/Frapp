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

  useEffect(() => {
    if (!channelId) return;
    /*
      Claim the shell's text for this channel synchronously, before the
      asynchronous restore below can race it. The text is already in
      `draftState`; all that is missing is the record of whose it is.
    */
    if (typedBeforeChannel.current) {
      typedBeforeChannel.current = false;
      typedFor.current = channelId;
    }
    let cancelled = false;
    loadDraft(channelId)
      .then((body) => {
        if (cancelled) return;
        /*
          A persisted draft never overwrites text the member has already typed
          for this same channel.

          Note this is not #1497, which is the reverse: `draftState` still
          holding the *outgoing* channel's text across a switch. That case has a
          different id in `typedFor` and is deliberately left alone here.
        */
        if (typedFor.current === channelId) return;
        setDraftState(body);
      })
      .catch((err) => {
        // IndexedDB read can throw in private mode / quota issues — degrade to
        // an empty draft rather than crash the channel.
        console.warn("loadDraft failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

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
      setDraftState(body);
      if (!channelId) {
        // The composer shell, mid cold load. There is nothing to attribute the
        // text to yet and nothing to persist it under; the effect above claims
        // it the moment a channel arrives.
        typedBeforeChannel.current = true;
        return;
      }
      typedFor.current = channelId;
      cancelPendingSave();
      saveTimer.current = setTimeout(() => {
        void saveDraft(channelId, body);
      }, SAVE_DEBOUNCE_MS);
    },
    [channelId, cancelPendingSave],
  );

  const clearAfterSend = useCallback(async () => {
    setDraftState("");
    if (!channelId) return;
    // Same Dexie drafts table `sendMessage` already cleared best-effort. A
    // second fault must not reject a send that already posted (#1718).
    try {
      await clearDraft(channelId);
    } catch {
      // Best-effort — in-flight saveDraft races are why this call exists.
    }
  }, [channelId]);

  return { draft, setDraft, cancelPendingSave, clearAfterSend };
}
