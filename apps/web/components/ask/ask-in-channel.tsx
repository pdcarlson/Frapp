"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EyeOff } from "lucide-react";
import {
  askTurnsInChannel,
  useAsk,
  useMyPermissions,
  type ActResponse,
  type AskExchange,
  type AskOptions,
  type AskProposalResolution,
} from "@repo/hooks";
import {
  ASK_COPY,
  ASK_MENTION_NAME,
  can,
  type AskAccess,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { AskReply } from "@/components/ask/ask-answer";
import { FrappCrest } from "@/components/ask/frapp-crest";
import {
  AskCardEditsContext,
  type AskCardEditsStore,
} from "@/components/ask/ask-proposal";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";

/**
 * `@Frapp` in a channel, answered to the asker alone (#4713).
 *
 * A member with Ask picks Frapp from the composer's `@` list, types a
 * question and sends. Nothing is posted: the question goes to Ask, and the
 * answer is drawn in the channel where it was asked, under the message that
 * was newest at the time, for this member and nobody else. Slack draws a
 * slash command's reply the same way ("Only visible to you"), and Discord an
 * ephemeral one ("Only you can see this · Dismiss message"). Both keep it in
 * the flow of the channel, in the place it was asked, so the answer is read
 * beside the conversation that prompted it.
 *
 * **It is a turn of the one conversation, not a message.** The turn lives in
 * the Ask conversation (`useAsk`, held by `AskHost`), so the card opened from
 * the composer shows it too and a follow-up there leans on it. The channel
 * only draws the turns that were asked in it. Nothing about the turn is a
 * row in the channel's messages: it is not sent, stored or synced, so it is
 * gone on reload, like the rest of the conversation
 * (`spec/behavior/ai.md` § One conversation).
 *
 * **It reads as Frapp speaking in the channel, marked as private.** The
 * row has a message's shape (a 32px mark in the gutter, a name, then the
 * words) so it sits in the thread without a frame around it, on the app's
 * own background. What tells it apart is said, not coloured: "Only you can
 * see this" beside the name, and the member's own question quoted above the
 * answer, since no message of theirs is there to show what was asked.
 * Dismiss takes it out of the channel; it stays in Ask.
 *
 * **What it does not carry.** The "answers are being saved" line is shown
 * only in Ask's own field, so a question from a channel never says it was
 * shown and the beta diagnostics window keeps nothing from it.
 *
 * **An answer being written redraws its own row and nothing else.** The
 * conversation changes with every piece of an answer that arrives, from any
 * door. So it is not in the context the chat reads: the actions are (they
 * change only when a question starts or ends), and the turns sit in a small
 * store. The chat subscribes to which turns are in its channel and where
 * (`useChannelAskTurns`), which a streamed answer does not change, and each
 * row subscribes to its own turn (`AskChannelTurn`).
 */
interface AskInChannel {
  /** A question is being answered: a second one waits its turn. */
  busy: boolean;
  /** Ask from `channelId`'s composer; `after` is its newest message's key. */
  send: (channelId: string, question: string, after: string | null) => void;
  retry: (id: string) => void;
  setProposal: (id: string, proposal: ActResponse) => void;
  resolveProposal: (id: string, resolution: AskProposalResolution) => void;
  dismiss: (id: string) => void;
  /** What was changed on waiting cards, shared with the Ask card. */
  edits: AskCardEditsStore;
}

/** A turn as a channel places it: which one, and where it was asked. */
export type AskChannelPlace = Pick<AskExchange, "id" | "origin">;

/** The conversation's turns, outside React's render path (see above). */
interface AskTurnsStore {
  subscribe: (listener: () => void) => () => void;
  get: () => readonly AskExchange[];
  set: (exchanges: readonly AskExchange[]) => void;
}

const NO_TURNS: readonly AskExchange[] = [];
const NO_PLACES: readonly AskChannelPlace[] = [];

function createAskTurnsStore(): AskTurnsStore {
  let turns = NO_TURNS;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => turns,
    set: (next) => {
      if (next === turns) return;
      turns = next;
      for (const listener of listeners) listener();
    },
  };
}

const AskInChannelContext = createContext<AskInChannel | null>(null);
const AskTurnsContext = createContext<AskTurnsStore | null>(null);
const AskAccessContext = createContext<AskAccess>("no");

/**
 * Holds what a channel needs to ask and to draw its turns. Always mounted
 * by `AskHost`, so the tree under it never changes shape; `access` is
 * whether this member has Ask, and unless it is `yes` every reader gets
 * `null` and no turn is drawn.
 */
export function AskInChannelBridge({
  access,
  children,
}: {
  access: AskAccess;
  children: ReactNode;
}) {
  const enabled = access === "yes";
  const {
    exchanges,
    working,
    ask,
    retry,
    setProposal,
    resolveProposal,
    dismissFromChannel,
  } = useAsk();
  const { ensureConsent, consentDialog } = useAiConsentGate();
  const permissions = useMyPermissions().data?.permissions;
  const mayAct = !!permissions && can("ai:act", permissions);
  const [edits] = useState<AskCardEditsStore>(() => new Map());
  const [turns] = useState(createAskTurnsStore);
  // Before paint, so a question's row is there in the frame its text leaves
  // the composer.
  useLayoutEffect(() => {
    turns.set(enabled ? exchanges : NO_TURNS);
  }, [turns, enabled, exchanges]);

  // The same asks the card makes, less the saved line (see above).
  const options = useCallback(
    (): AskOptions => ({ actions: mayAct, gate: ensureConsent }),
    [mayAct, ensureConsent],
  );
  const send = useCallback(
    (channelId: string, question: string, after: string | null) => {
      void ask(question, { ...options(), channelId, afterMessage: after });
    },
    [ask, options],
  );
  const retryTurn = useCallback(
    (id: string) => void retry(id, options()),
    [retry, options],
  );

  const value = useMemo<AskInChannel | null>(
    () =>
      enabled
        ? {
            busy: working,
            send,
            retry: retryTurn,
            setProposal,
            resolveProposal,
            dismiss: dismissFromChannel,
            edits,
          }
        : null,
    [
      enabled,
      working,
      send,
      retryTurn,
      setProposal,
      resolveProposal,
      dismissFromChannel,
      edits,
    ],
  );

  return (
    <AskAccessContext.Provider value={access}>
      <AskTurnsContext.Provider value={turns}>
        <AskInChannelContext.Provider value={value}>
          {children}
          {enabled ? consentDialog : null}
        </AskInChannelContext.Provider>
      </AskTurnsContext.Provider>
    </AskAccessContext.Provider>
  );
}

/**
 * Whether this member has Ask, for a composer deciding what Send does with
 * a message that names `@Frapp`: asked on `yes`, posted on `no`, and held on
 * `unknown` (`readChannelAsk`). `no` outside the dashboard.
 */
export function useChannelAskAccess(): AskAccess {
  return useContext(AskAccessContext);
}

/** What was changed on waiting cards, for the Ask card to share. */
export function useSharedAskCardEdits(): AskCardEditsStore | null {
  return useContext(AskInChannelContext)?.edits ?? null;
}

/**
 * Asking from a channel's composer, or `null` for a member without Ask (who
 * gets no Frapp in the `@` list, and whose `@Frapp` is ordinary text).
 */
export function useChannelAsk(): Pick<AskInChannel, "busy" | "send"> | null {
  const channel = useContext(AskInChannelContext);
  return useMemo(
    () => (channel ? { busy: channel.busy, send: channel.send } : null),
    [channel],
  );
}

const subscribeToNothing = () => () => {};

/**
 * The turns asked in this channel and still shown there, oldest first: which
 * they are and where each was asked, for placing. The list is the same one
 * until a turn is added, dismissed or asked again, so an answer being
 * written does not redraw the channel.
 */
export function useChannelAskTurns(
  channelId: string | null | undefined,
): readonly AskChannelPlace[] {
  const store = useContext(AskTurnsContext);
  const last = useRef(NO_PLACES);
  const read = useCallback(() => {
    const now = askTurnsInChannel(store?.get() ?? NO_TURNS, channelId);
    const was = last.current;
    const same =
      was.length === now.length &&
      now.every(
        (turn, i) => was[i]!.id === turn.id && was[i]!.origin === turn.origin,
      );
    if (!same) {
      last.current =
        now.length === 0
          ? NO_PLACES
          : now.map(({ id, origin }) => ({ id, origin }));
    }
    return last.current;
  }, [store, channelId]);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    read,
    () => NO_PLACES,
  );
}

/** One turn of the conversation, redrawn as its answer arrives. */
function useAskTurn(id: string): AskExchange | null {
  const store = useContext(AskTurnsContext);
  const read = useCallback(
    () => store?.get().find((turn) => turn.id === id) ?? null,
    [store, id],
  );
  return useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    read,
    () => null,
  );
}

/**
 * One turn, drawn among a channel's messages for the member who asked it.
 * A message row's measures (`message-item.tsx`: 20px sides, a 32px gutter,
 * 12px to the words, 16px above a new speaker), so it lines up with the
 * messages either side of it.
 */
export function AskChannelTurn({ id }: { id: string }) {
  const channel = useContext(AskInChannelContext);
  const exchange = useAskTurn(id);
  if (!channel || !exchange) return null;
  return (
    <article
      data-ask-channel-turn={exchange.id}
      aria-label={`${ASK_MENTION_NAME}. ${ASK_COPY.only_you}.`}
      className="flex gap-3 px-5 pb-1 pt-4"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1"
      >
        <FrappCrest className="h-[17px] w-[14px] text-primary" />
      </span>
      <div className="min-w-0 max-w-2xl flex-1 space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2 leading-5">
          <span className="text-sm font-semibold text-foreground">
            {ASK_MENTION_NAME}
          </span>
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <EyeOff className="h-3 w-3 self-center" aria-hidden="true" />
            {ASK_COPY.only_you}
          </span>
        </p>
        {/* The member's own words: no message of theirs was posted, so the
            turn has to say what was asked. */}
        <p className="whitespace-pre-wrap break-words border-l-2 border-border pl-2.5 text-sm text-muted-foreground">
          {exchange.question}
        </p>
        <AskCardEditsContext.Provider value={channel.edits}>
          <AskReply
            exchange={exchange}
            busy={channel.busy && exchange.phase !== "working"}
            onRetry={() => channel.retry(exchange.id)}
            onAnswerConsent={() => channel.retry(exchange.id)}
            onProposal={(proposal) =>
              channel.setProposal(exchange.id, proposal)
            }
            onResolved={(resolution) =>
              channel.resolveProposal(exchange.id, resolution)
            }
          />
        </AskCardEditsContext.Provider>
        {exchange.phase !== "working" ? (
          <button
            type="button"
            onClick={() => channel.dismiss(exchange.id)}
            className={cn(
              // 44px to a finger.
              "rounded-sm text-caption text-muted-foreground underline-offset-2 hover:text-foreground hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center",
              FOCUS_RING,
            )}
          >
            {ASK_COPY.dismiss}
          </button>
        ) : null}
      </div>
    </article>
  );
}
