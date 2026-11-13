"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { codeOf, throwUnlessOk, type components } from "@repo/api-sdk";
import {
  ASK_COPY,
  askHistory,
  createAskStreamReader,
  type AskAnswer,
  type AskStepDetail,
  type AskStreamEvent,
  type AskSuggestion,
} from "@repo/validation";
import { errorCopy } from "./error-copy";
import type { ActResponse } from "./use-act";
import { aiConsentKey, isAiNotAvailable } from "./use-ai";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Ask Frapp on the client (#450, #451, `spec/behavior/ai.md`), shared by web
 * and, when its slice comes, mobile.
 *
 * The answer arrives as a stream of events whose format lives in
 * `@repo/validation` (`ask.ts`). What this module adds is the reading: the
 * step the server is on, the text as it is written, and then the checked
 * answer, which replaces what streamed, or the proposal card the member's
 * words asked for.
 *
 * It also holds the conversation (`ai.md` § One conversation): every turn of
 * this sitting, in order. The server keeps nothing between questions, so the
 * turns before a question are sent with it (`askHistory`). The conversation
 * lives as long as whatever holds it, and is gone on reload: the app's
 * `AskConversationProvider`, so that Ask's own screen and a channel a member
 * asked `@Frapp` from show the same thread (#4713), or, with no provider
 * above it, the screen that calls `useAsk`.
 */

/** `GET /v1/ai/ask`: whether exchanges are being kept, and who may change that. */
export type AskStatus = components["schemas"]["AskStatusDto"];

const askStatusKey = (chapterId: string | null | undefined) =>
  ["ai", "ask", "status", chapterId] as const;

/**
 * What Ask needs before the first question, or `null` when the server has no
 * AI. Read again each time the panel opens (`staleTime` is short): the
 * "answers are being saved" line has to be true at the moment of asking.
 */
export function useAskStatus(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: askStatusKey(chapterId),
    queryFn: async (): Promise<AskStatus | null> => {
      const result = await client.GET("/v1/ai/ask");
      if (isAiNotAvailable(result.error)) return null;
      throwUnlessOk(result);
      if (result.data === undefined) {
        throw new Error("The Ask route returned no body.");
      }
      return result.data;
    },
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

const askSuggestionsKey = (chapterId: string | null | undefined) =>
  ["ai", "ask", "suggestions", chapterId] as const;

/**
 * What Ask opens with for this member (#4700): questions and one request
 * built on the server from their own records, with no model call. Empty
 * until it arrives and whenever it cannot be read, so a screen shows its
 * plain opening and nothing waits on this.
 *
 * Read when Ask opens, and never again while it is open: a list on screen
 * does not change under a thumb. Reopened within a minute it is the same
 * list. Reopened later it is read again, and it is empty until the new one
 * arrives, so a row for a task finished since is never shown and then
 * swapped for another.
 */
export function useAskSuggestions(options?: { enabled?: boolean }): {
  suggestions: AskSuggestion[];
} {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const query = useQuery({
    queryKey: askSuggestionsKey(chapterId),
    queryFn: async (): Promise<AskSuggestion[]> => {
      const result = await client.GET("/v1/ai/ask/suggestions");
      if (isAiNotAvailable(result.error)) return [];
      throwUnlessOk(result);
      return result.data?.suggestions ?? [];
    },
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
  return { suggestions: query.isFetching ? [] : (query.data ?? []) };
}

/**
 * The president turning the beta diagnostics window on (`on: true`) or off.
 * The server's answer is written into the cached status, so the settings row
 * and Ask's "being saved" line change together.
 */
export function useSetAskDiagnostics() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["ai-ask", "diagnostics"],
    retry: false,
    mutationFn: async (on: boolean) => {
      const result = on
        ? await client.POST("/v1/ai/ask/diagnostics")
        : await client.DELETE("/v1/ai/ask/diagnostics");
      throwUnlessOk(result);
      if (result.data === undefined) {
        throw new Error("The Ask route returned no body.");
      }
      return result.data;
    },
    onSuccess: (diagnostics) => {
      queryClient.setQueryData(
        askStatusKey(chapterId),
        (): AskStatus => ({ saved_until: diagnostics.ends_at, diagnostics }),
      );
    },
    onError: () => {
      // Already on in another tab, or the presidency moved: read it again.
      void queryClient.invalidateQueries({ queryKey: askStatusKey(chapterId) });
    },
  });
}

/** How a proposal card ended, so its turn can say so in the card's place. */
export type AskProposalResolution =
  | {
      kind: "done";
      /** "Task created", "Gave 5 points to 12 members". */
      line: string;
      /** The page the change can be seen on, or null for none. Open. */
      page: string | null;
    }
  | { kind: "cancelled" }
  /** It stopped waiting before the member decided: a day passed, or it was decided elsewhere. */
  | { kind: "gone" };

/**
 * Where a turn was asked, when that was a chat composer (`@Frapp`, #4713).
 * The turn is drawn in that channel for the asker alone, at the moment it
 * was asked, as well as in Ask's thread. It is never a message: nothing
 * about it is sent to the channel.
 */
interface AskOrigin {
  channelId: string;
  /** When it was asked (ISO), which is where it sits among the messages. */
  at: string;
  /**
   * The newest message in the channel when it was asked, by the key the
   * list draws it under (`client_message_id ?? id`), or null for none. The
   * turn sits under that message; `at` places it when the message is gone.
   * A key, because two clocks need not agree on which message came first.
   */
  after?: string | null;
  /** The member dismissed it from the channel. It stays in Ask's thread. */
  dismissed?: boolean;
}

/** One turn: what the member typed and what has come back for it so far. */
export interface AskExchange {
  /** This turn's place in the conversation: a list key, and what the turn's changes name. */
  id: string;
  question: string;
  /**
   * The member tapped this from the opening suggestions and did not type it.
   * It can name a record another member wrote, so it is sent without
   * `actions` and marked in later history (`ask.ts`).
   */
  suggested?: boolean;
  /**
   * Earlier turns were sent with this question. Its answer leaned on them,
   * so it is not offered to the channel (`ai.ask.post.follow_up`, #4713).
   */
  followedUp?: boolean;
  /**
   * The server's id for this ask, from the stream's `start` event: what
   * "Report this" names (#4315). Null until the stream begins.
   */
  askId?: string | null;
  /** `working` until the server's `done`; `failed` when no answer arrived. */
  phase: "working" | "done" | "failed";
  /**
   * The step the server last named, while working. Open on the wire. Null
   * while a working turn has not been sent yet (the AI question is open).
   */
  step: string | null;
  /** What that step said is being read, for the line under the turn. */
  stepDetail?: AskStepDetail | null;
  /**
   * What the turn's `reading` step named, kept once the answer lands, for
   * the line under it ("Read the events calendar and 3 sources",
   * `askReadLine`). Absent for a turn that never reached that step.
   */
  read?: AskStepDetail | null;
  /** The text as it streams. A preview: `answer` replaces it. */
  preview: string;
  answer: AskAnswer | null;
  /**
   * The member asked for something to be done: the card, the choice of
   * event, or what was left unsaid, in place of an answer. Nothing has
   * changed until the card is confirmed.
   */
  proposal: ActResponse | null;
  /** Set once the proposal was confirmed or dismissed. */
  resolution: AskProposalResolution | null;
  /** Why it failed, in words to show, and whether asking again may work. */
  failure: { message: string; retryable: boolean } | null;
  /** Set when the turn was asked from a chat composer. */
  origin?: AskOrigin;
}

/** An answer no stream was opened for: the server refused before it began. */
function unavailable(reason: string): AskAnswer {
  return {
    status: "unavailable",
    reason,
    text: "",
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  };
}

/** The pre-stream refusals a client acts on, as the answer they amount to. */
const REFUSAL_REASONS: Record<string, string> = {
  "ai.consent.required": "consent_required",
  "ai.chapter_off": "chapter_off",
  "ai.not_available": "not_available",
};

/** The exchange after one stream event. Pure, so it is tested without a stream. */
export function applyAskEvent(
  exchange: AskExchange,
  event: AskStreamEvent,
): AskExchange {
  // `done`, `proposal` and `error` are final: a late delta never reopens a turn.
  if (exchange.phase !== "working") return exchange;
  switch (event.type) {
    case "start":
      return { ...exchange, askId: event.ask_id };
    case "status":
      return {
        ...exchange,
        step: event.step,
        // Each step replaces the last one's detail, so "3 sources" never
        // outlives the step that counted them.
        // `label` is the tool loop's own line for the read that just
        // started ("Searching messages"); `askStepLine` shows it whole.
        stepDetail: {
          reads: event.reads,
          found: event.found,
          label: event.label,
        },
        // What was read is also what the finished answer says it read.
        ...(event.step === "reading"
          ? { read: { reads: event.reads, found: event.found } }
          : {}),
      };
    case "text":
      return { ...exchange, preview: exchange.preview + event.delta };
    case "done":
      return {
        ...exchange,
        phase: "done",
        step: null,
        stepDetail: null,
        preview: "",
        answer: event.answer,
      };
    case "proposal":
      return {
        ...exchange,
        phase: "done",
        step: null,
        stepDetail: null,
        preview: "",
        // The shape `POST /v1/ai/act` answers with; open on the wire, and
        // the card shows a status it does not know as the generic line.
        proposal: event.act as unknown as ActResponse,
      };
    case "error":
      // Nothing shown so far stands (`ask.ts`), so the preview goes too.
      return {
        ...exchange,
        phase: "failed",
        step: null,
        stepDetail: null,
        preview: "",
        failure: { message: ASK_COPY.failed, retryable: event.retryable },
      };
  }
}

function failed(exchange: AskExchange, message: string): AskExchange {
  return {
    ...exchange,
    phase: "failed",
    step: null,
    stepDetail: null,
    preview: "",
    failure: { message, retryable: true },
  };
}

/**
 * What is sent as the conversation before a new question: the turns that
 * finished, oldest first. A turn that failed or never reached the server
 * said nothing worth carrying.
 */
function askHistoryOf(exchanges: readonly AskExchange[]) {
  return askHistory(
    exchanges
      .filter(
        (exchange) =>
          exchange.phase === "done" &&
          exchange.answer?.status !== "unavailable",
      )
      .map(({ question, answer, suggested }) => ({
        question,
        answer,
        suggested,
      })),
  );
}

export interface AskOptions {
  /** The "answers are being saved" line was on screen (`ask.ts`). */
  savedNoticeShown?: boolean;
  /** This screen shows proposal cards, and the member may have Frapp act. */
  actions?: boolean;
  /**
   * The words are an opening suggestion the member tapped, not ones they
   * typed. A suggested turn never asks for a card, whatever `actions` says.
   */
  suggested?: boolean;
  /**
   * Runs after the question is on screen and before it is sent: the AI
   * sheet's gate. False ends the turn as "answer the AI question first"; a
   * throw ends it as a failure to try again.
   */
  gate?: () => Promise<boolean>;
  /**
   * The channel whose composer this was typed in, with `@Frapp` (#4713).
   * The turn is then also drawn there, for the asker alone, and the request
   * says which door it came through. A turn asked again keeps where it was
   * first asked.
   */
  channelId?: string;
  /** With `channelId`: the newest message there now (`AskOrigin.after`). */
  afterMessage?: string | null;
}

let nextExchange = 0;

/** The conversation, and what can be done to it. */
export interface AskConversation {
  exchanges: AskExchange[];
  /** A turn is waiting on the server. */
  working: boolean;
  ask: (question: string, options?: AskOptions) => Promise<void>;
  retry: (id: string, options?: AskOptions) => Promise<void>;
  /** Replaces a turn's proposal: the event picked for "everyone who came". */
  setProposal: (id: string, proposal: ActResponse) => void;
  /** Records that a turn's card was confirmed or dismissed. */
  resolveProposal: (id: string, resolution: AskProposalResolution) => void;
  /**
   * Takes a turn asked from a channel out of that channel's view. It stays
   * in the conversation, so Ask's own screen still shows it.
   */
  dismissFromChannel: (id: string) => void;
  stop: () => void;
  reset: () => void;
}

const AskConversationContext = createContext<AskConversation | null>(null);

/**
 * Holds one conversation for everything under it (#4713): Ask's own screen
 * and each channel a member asks `@Frapp` from read and write the same
 * turns. Mounted once, above both. `scope` says whose it is, so a
 * conversation never follows a member into another chapter or account.
 */
export function AskConversationProvider({
  scope,
  children,
}: {
  /**
   * Whose conversation this is, as one string (the member and the chapter).
   * When it changes the conversation starts over. Not a `key`, which would
   * remount everything under the provider too.
   */
  scope?: string | null;
  children: ReactNode;
}) {
  const conversation = useAskConversation();
  const { reset } = conversation;
  const held = useRef(scope);
  useEffect(() => {
    if (held.current === scope) return;
    held.current = scope;
    reset();
  }, [scope, reset]);
  return createElement(
    AskConversationContext.Provider,
    { value: conversation },
    children,
  );
}

/**
 * Asks, and holds the conversation on screen.
 *
 * `ask` adds a turn and resolves when it is over, however it ended; it never
 * rejects. `retry` asks a failed turn's question again in its place at the
 * end. `stop` abandons the question in flight and takes its turn away
 * (closing the panel), and `reset` starts a new conversation.
 *
 * Under an `AskConversationProvider` this is the shared conversation. With
 * none above it, the caller holds a conversation of its own, as every caller
 * did before #4713.
 */
export function useAsk(): AskConversation {
  const shared = useContext(AskConversationContext);
  // Always called, so the hook order is the same either way; with a shared
  // conversation this one is never asked anything and stays empty.
  const own = useAskConversation();
  return shared ?? own;
}

/**
 * The turns of the conversation that were asked from this channel and not
 * dismissed there, oldest first. Empty with no channel.
 */
export function askTurnsInChannel(
  exchanges: readonly AskExchange[],
  channelId: string | null | undefined,
): AskExchange[] {
  if (!channelId) return [];
  return exchanges.filter(
    (exchange) =>
      exchange.origin?.channelId === channelId && !exchange.origin.dismissed,
  );
}

/** The key turns are listed under when they sit above every row. */
export const ASK_TURNS_ABOVE_ALL = "";

/**
 * Where each turn asked in a channel sits among that channel's rows: under
 * the row it names (`AskOrigin.after`), or, when that row is not in the list,
 * under the last row sent at or before the turn was asked. A turn older than
 * every row sits above them all ({@link ASK_TURNS_ABOVE_ALL}).
 *
 * `rows` are the list's rows, oldest first. Both clients draw from this, so
 * a turn is in the same place on each.
 */
export function placeAskTurns<T extends Pick<AskExchange, "origin">>(
  rows: readonly { key: string; at: string }[],
  turns: readonly T[],
): Map<string, T[]> {
  const placed = new Map<string, T[]>();
  if (turns.length === 0) return placed;
  const keys = new Set(rows.map((row) => row.key));
  for (const turn of turns) {
    if (!turn.origin) continue;
    let under = ASK_TURNS_ABOVE_ALL;
    if (turn.origin.after && keys.has(turn.origin.after)) {
      under = turn.origin.after;
    } else {
      const asked = Date.parse(turn.origin.at);
      for (const row of rows) {
        // An unreadable time sorts the row before the turn: a turn is never
        // lifted above a message because of a bad date on it.
        const sent = Date.parse(row.at);
        if (!Number.isNaN(sent) && sent > asked) break;
        under = row.key;
      }
    }
    const list = placed.get(under);
    if (list) list.push(turn);
    else placed.set(under, [turn]);
  }
  return placed;
}

function useAskConversation(): AskConversation {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const [exchanges, setExchanges] = useState<AskExchange[]>([]);
  // What `ask` reads the conversation from: state as of the last render is a
  // turn behind when two calls land in one tick.
  const latest = useRef<AskExchange[]>([]);
  const inFlight = useRef<AbortController | null>(null);

  const write = useCallback(
    (change: (current: AskExchange[]) => AskExchange[]) => {
      latest.current = change(latest.current);
      setExchanges(latest.current);
    },
    [],
  );

  const stop = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    if (latest.current.some((exchange) => exchange.phase === "working")) {
      write((current) =>
        current.filter((exchange) => exchange.phase !== "working"),
      );
    }
  }, [write]);

  const reset = useCallback(() => {
    stop();
    write(() => []);
  }, [stop, write]);

  // A screen that unmounts mid-answer stops paying for the rest of it.
  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
    },
    [],
  );

  const patch = useCallback(
    (id: string, change: (current: AskExchange) => AskExchange) => {
      write((current) =>
        current.map((exchange) =>
          exchange.id === id ? change(exchange) : exchange,
        ),
      );
    },
    [write],
  );

  const run = useCallback(
    async (question: string, options: AskOptions | undefined, drop?: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      // One question at a time: a turn still waiting is abandoned.
      stop();
      const abort = new AbortController();
      inFlight.current = abort;
      const id = `turn-${(nextExchange += 1)}`;
      const earlier = latest.current.filter((exchange) => exchange.id !== drop);
      const history = askHistoryOf(earlier);
      // A turn asked again stays where it was first asked: its place in the
      // channel, or Ask's own screen.
      const again = drop
        ? latest.current.find((exchange) => exchange.id === drop)
        : undefined;
      const origin: AskOrigin | undefined = again
        ? again.origin
        : options?.channelId
          ? {
              channelId: options.channelId,
              at: new Date().toISOString(),
              after: options.afterMessage ?? null,
            }
          : undefined;
      /** Applies a change unless this turn was abandoned. */
      const update = (change: (current: AskExchange) => AskExchange) => {
        if (inFlight.current === abort) patch(id, change);
      };

      write(() => [
        ...earlier,
        {
          id,
          question: trimmed,
          ...(options?.suggested ? { suggested: true } : {}),
          ...(history.length > 0 ? { followedUp: true } : {}),
          phase: "working",
          // Nothing is being searched while the AI question is still on
          // screen, so the turn says nothing until the request is sent.
          step: options?.gate ? null : "searching",
          preview: "",
          answer: null,
          proposal: null,
          resolution: null,
          failure: null,
          ...(origin ? { origin } : {}),
        },
      ]);

      try {
        if (options?.gate) {
          let agreed: boolean;
          try {
            agreed = await options.gate();
          } catch (error) {
            update((current) =>
              failed(current, errorCopy(error, ASK_COPY.failed)),
            );
            return;
          }
          if (!agreed) {
            update((current) => ({
              ...current,
              phase: "done",
              step: null,
              stepDetail: null,
              answer: unavailable("consent_required"),
            }));
            return;
          }
          if (abort.signal.aborted) return;
          update((current) => ({ ...current, step: "searching" }));
        }
        const result = await client.POST("/v1/ai/ask", {
          body: {
            question: trimmed,
            ...(history.length > 0 ? { history } : {}),
            ...(options?.actions && !options.suggested
              ? { actions: true }
              : {}),
            ...(options?.savedNoticeShown ? { saved_notice_shown: true } : {}),
            // Only the new door is named: a server from before #4713
            // refuses a field it does not know, and "ask" is its default.
            ...(origin ? { door: "chat_private" as const } : {}),
            // What the member had open, so "this channel" means something
            // to the tool loop (#4904). Ask's own screen sends none. A server
            // from before #4941 refuses the field; web deploys with the API
            // and a phone build or update ships only after its API has.
            ...(origin ? { from: { channel_id: origin.channelId } } : {}),
          },
          parseAs: "stream",
          signal: abort.signal,
        });
        if (result.error !== undefined || !result.response.ok) {
          const reason = REFUSAL_REASONS[codeOf(result.error) ?? ""];
          if (reason === "consent_required") {
            // The server says the member has not said yes, so what this
            // client holds is out of date (a No on another device, or a new
            // sheet). Read it again, so the way back opens the sheet.
            await queryClient.invalidateQueries({ queryKey: aiConsentKey });
          }
          update((current) =>
            reason
              ? {
                  ...current,
                  phase: "done",
                  step: null,
                  stepDetail: null,
                  answer: unavailable(reason),
                }
              : failed(current, errorCopy(result.error, ASK_COPY.failed)),
          );
          return;
        }
        const body = result.data as ReadableStream<Uint8Array> | null | undefined;
        if (!body) {
          update((current) => failed(current, ASK_COPY.failed));
          return;
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();
        const frames = createAskStreamReader();
        let ended = false;
        while (!ended) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of frames.feed(decoder.decode(value, { stream: true }))) {
            update((current) => applyAskEvent(current, event));
            if (
              event.type === "done" ||
              event.type === "proposal" ||
              event.type === "error"
            ) {
              ended = true;
            }
          }
        }
        if (ended) {
          void reader.cancel().catch(() => undefined);
        } else {
          // The connection closed before the server said how it ended.
          update((current) => failed(current, ASK_COPY.failed));
        }
      } catch {
        // An abort is this hook's own doing; anything else is the network.
        if (!abort.signal.aborted) {
          update((current) => failed(current, ASK_COPY.failed));
        }
      } finally {
        if (inFlight.current === abort) inFlight.current = null;
      }
    },
    [client, patch, queryClient, stop, write],
  );

  const ask = useCallback(
    (question: string, options?: AskOptions) => run(question, options),
    [run],
  );

  const retry = useCallback(
    (id: string, options?: AskOptions) => {
      // An older turn's Try again never abandons the turn being answered:
      // the member asked that one last, and it would vanish from the thread.
      const busy = latest.current.some(
        (exchange) => exchange.phase === "working" && exchange.id !== id,
      );
      const again = latest.current.find((exchange) => exchange.id === id);
      return again && !busy
        ? run(
            again.question,
            // A suggestion asked again is still not the member's own words.
            again.suggested ? { ...options, suggested: true } : options,
            id,
          )
        : Promise.resolve();
    },
    [run],
  );

  const setProposal = useCallback(
    (id: string, proposal: ActResponse) =>
      patch(id, (current) => ({ ...current, proposal, resolution: null })),
    [patch],
  );

  const resolveProposal = useCallback(
    (id: string, resolution: AskProposalResolution) =>
      patch(id, (current) => ({ ...current, resolution })),
    [patch],
  );

  const dismissFromChannel = useCallback(
    (id: string) =>
      patch(id, (current) =>
        current.origin
          ? { ...current, origin: { ...current.origin, dismissed: true } }
          : current,
      ),
    [patch],
  );

  return {
    exchanges,
    working: exchanges.some((exchange) => exchange.phase === "working"),
    ask,
    retry,
    setProposal,
    resolveProposal,
    dismissFromChannel,
    stop,
    reset,
  };
}
