"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy, Download, Lightbulb, LoaderCircle } from "lucide-react";
import {
  useAskSignal,
  useAskThumbs,
  type ActResponse,
  type AskExchange,
  type AskCardEnd,
  type AskProposalResolution,
} from "@repo/hooks";
import {
  ASK_COPY,
  ASK_EFFORT_COPY,
  ASK_POST_COPY,
  askAnswerEntities,
  askLeftOutLine,
  askOffersThinkHarder,
  askPostedSourceTitle,
  askSourceChip,
  askUnavailableLine,
  askUnavailableOffersRetry,
  type AskAnswer,
  type AskEntity,
  type AskPostedAnswer,
  type AskSource,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import {
  AskChannelOpens,
  onPlainClick,
} from "@/components/ask/ask-entity-text";
import { AskMarkdown, AskPreviewMarkdown } from "@/components/ask/ask-markdown";
import { askPlainWords, type AskMarker } from "@repo/chat-core/ask-markdown";
import { AskAnswerCards, AskProposal } from "@/components/ask/ask-proposal";
import { AskSteps } from "@/components/ask/ask-steps";
import {
  askSourceBackworkId,
  askSourceHref,
  askSourceIsMessage,
} from "@/components/ask/ask-source-link";
import { useAskBackworkDownload } from "@/components/ask/use-ask-backwork-download";
import { ReportAiButton } from "@/components/ai/report-ai";
import {
  AskThumbButtons,
  AskThumbsFollowUp,
} from "@/components/ask/ask-thumbs";

/**
 * What the member asked, in a bubble on the right in the chapter's solid
 * colour, a heading for each turn. Ask's opening draws the starter's "What
 * can you do?" in the same bubble (`ask-opening.tsx`), since it stands for
 * the member's words.
 */
export function AskQuestionBubble({ children }: { children: string }) {
  return (
    <h3 className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-[6px] bg-primary px-3.5 py-2 text-sm font-normal text-primary-foreground">
      {children}
    </h3>
  );
}

/**
 * One turn of the Ask conversation: what the member typed, then what Frapp
 * came back with. That is an answer with a numbered marker at each cited
 * sentence and the sources those markers open (#451), or the card for
 * something the member asked to have done (`ask-proposal.tsx`).
 *
 * **Who said what is told by shape, not by labels.** The member's words sit
 * in a bubble on the right; Frapp's answer is plain text on the left with no
 * bubble, the way ChatGPT, Claude and Slack's assistant all draw a
 * conversation with one person and one assistant. An answer is the thing
 * being read, so it gets the full width and no frame; only a proposal, which
 * is a thing to act on, is a card.
 *
 * The markers and the sources follow what members already read elsewhere:
 * Notion AI and Perplexity put a small numbered chip at the end of the
 * sentence it backs and the same numbers on a row of source chips under the
 * answer. Each opens its source: the document in the viewer, the minutes,
 * the message in its channel, or the page live data came from.
 *
 * **Nothing above the fold moves while it works.** What Frapp is doing is a
 * list of steps (`ask-steps.tsx`, #5427) that only grows at the end of the
 * thread and folds into one row at the answer's first word, before any of
 * the answer is under it. The streamed text is a preview: the server decides
 * what stands after the model stops, and `done` replaces it (`ask.ts`).
 *
 * **The answer is the loudest thing in its turn** (Paul, 2026-11-13: "there
 * just needs to be better hierarchy", "report shouldn't be so obvious", and
 * the conversation "should feel more agentic"). Above the words, the folded
 * steps say what Frapp did, as Perplexity's "Completed 2 steps" and Claude's
 * tool rows do (until #5427 one line under the words said what it read).
 * Then the source chips. Last, small muted icons, Copy and Report, as
 * ChatGPT, Claude and Gemini end an answer with a row of quiet icons.
 * "Report this" was a labelled button there, the only control under every
 * answer, and read as the thing to do next.
 */
export function AskTurn({
  exchange,
  busy = false,
  onFollowMessage,
  onRetry,
  onThinkHarder,
  onAnswerConsent,
  onProposal,
  onResolved,
  onCardEnded,
}: {
  exchange: AskExchange;
  /**
   * A source that is a chat message was followed. Its "page" is the thread
   * the conversation is drawn over, so the caller gets out of the way.
   */
  onFollowMessage?: () => void;
  /**
   * Another turn is being answered. Asking this one again would abandon it,
   * so this turn's Try again and consent buttons wait.
   */
  busy?: boolean;
  /**
   * Asks the same thing again in this turn's place: after a failure that may
   * not repeat, and on an answer Frapp couldn't give for a reason on its side
   * (`askUnavailableOffersRetry`).
   */
  onRetry: () => void;
  /**
   * Asks the same thing again in this turn's place with more effort (#4904).
   * Left out, the answer offers no Think harder.
   */
  onThinkHarder?: () => void;
  /** Opens the AI sheet, for a turn refused because it is unanswered. */
  onAnswerConsent: () => void;
  /** An event pick answered with a new proposal for this turn. */
  onProposal: (proposal: ActResponse) => void;
  /** This turn's card was confirmed or dismissed. */
  onResolved: (resolution: AskProposalResolution) => void;
  /** One of the cards under this turn's answer was confirmed or dismissed. */
  onCardEnded: (suggestionId: string, end: AskCardEnd) => void;
}) {
  return (
    <article className="space-y-3">
      <AskQuestionBubble>{exchange.question}</AskQuestionBubble>
      <AskReply
        exchange={exchange}
        busy={busy}
        onFollowMessage={onFollowMessage}
        onRetry={onRetry}
        onThinkHarder={onThinkHarder}
        onAnswerConsent={onAnswerConsent}
        onProposal={onProposal}
        onResolved={onResolved}
        onCardEnded={onCardEnded}
      />
    </article>
  );
}

/**
 * What Frapp came back with for one turn, without the member's words above
 * it: the step it is on, then the answer with its sources and its quiet row,
 * or the card, or the failure. `AskTurn` draws it under the question's
 * bubble; a channel draws it under Frapp's name for a turn asked there with
 * `@Frapp` (`ask-in-channel.tsx`, #4713), so an answer reads the same in
 * both places.
 */
export function AskReply({
  exchange,
  busy = false,
  onFollowMessage,
  onRetry,
  onThinkHarder,
  onAnswerConsent,
  onProposal,
  onResolved,
  onCardEnded,
}: {
  exchange: AskExchange;
  busy?: boolean;
  onFollowMessage?: () => void;
  onRetry: () => void;
  onThinkHarder?: () => void;
  onAnswerConsent: () => void;
  onProposal: (proposal: ActResponse) => void;
  onResolved: (resolution: AskProposalResolution) => void;
  /** One of the cards under this turn's answer was confirmed or dismissed. */
  onCardEnded: (suggestionId: string, end: AskCardEnd) => void;
}) {
  return (
    <div aria-live="polite" className="space-y-3">
      {/* What Frapp did, as steps: live while it reads, folded into one
          row from the answer's first word (#5427). */}
      <AskSteps
        steps={exchange.steps}
        folded={
          exchange.phase !== "working" ||
          exchange.step === "writing" ||
          exchange.preview !== ""
        }
      />
      {exchange.phase === "working" && exchange.preview ? (
        <div className="whitespace-pre-wrap text-sm text-foreground">
          <AskPreviewMarkdown text={exchange.preview} />
        </div>
      ) : null}
      {exchange.phase === "failed" && exchange.failure ? (
        <div className="space-y-2">
          <p className="text-sm text-foreground">{exchange.failure.message}</p>
          {exchange.failure.retryable ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={onRetry}
            >
              {ASK_COPY.try_again}
            </Button>
          ) : null}
        </div>
      ) : null}
      {exchange.phase === "done" && exchange.proposal ? (
        <AskProposal
          proposal={exchange.proposal}
          resolution={exchange.resolution}
          onProposal={onProposal}
          onResolved={onResolved}
        />
      ) : null}
      {exchange.phase === "done" && exchange.answer ? (
        <>
          <AskAnswerBody
            answer={exchange.answer}
            busy={busy}
            onAnswerConsent={onAnswerConsent}
            onRetry={onRetry}
            onFollowMessage={onFollowMessage}
          />
          {exchange.answer.proposals?.length ? (
            <CountedAnswerCards
              askId={exchange.answer.ask_id ?? null}
              ids={exchange.answer.proposals}
              ended={exchange.cards ?? NO_CARDS_ENDED}
              onEnded={onCardEnded}
            />
          ) : null}
          {/* Anything Ask wrote, or chose not to, can be reported. An
                answer that was never attempted has nothing AI-made in it. */}
          {exchange.answer.status !== "unavailable" && exchange.askId ? (
            <AnswerActions
              key={exchange.askId}
              askId={exchange.askId}
              answer={exchange.answer}
              busy={busy}
              onThinkHarder={
                onThinkHarder &&
                askOffersThinkHarder(exchange.answer, exchange.effort)
                  ? onThinkHarder
                  : undefined
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const NO_CARDS_ENDED: Readonly<Record<string, AskCardEnd>> = {};

/**
 * The cards under an answer, each one's end counted against the answer that
 * proposed it (`card_confirmed`, `card_dismissed`). A card that had stopped
 * waiting was neither.
 */
function CountedAnswerCards({
  askId,
  onEnded,
  ...cards
}: Parameters<typeof AskAnswerCards>[0] & { askId: string | null }) {
  const signal = useAskSignal();
  return (
    <AskAnswerCards
      {...cards}
      onEnded={(suggestionId, end) => {
        if (end.resolution.kind === "done") signal(askId, "card_confirmed");
        else if (end.resolution.kind === "cancelled") {
          signal(askId, "card_dismissed");
        }
        onEnded(suggestionId, end);
      }}
    />
  );
}

/**
 * The row under an answer: small, muted, and lit only under the pointer, so
 * the answer above it stays the thing being read. 32px to a mouse, 44 to a
 * finger.
 */
const QUIET_ACTION =
  "h-8 w-8 text-muted-foreground/70 hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11";

/**
 * Copy, the thumbs, Think harder and Report under a finished answer, and under them what a
 * thumbs down opens (`ask-thumbs.tsx`). The thumbs are drawn only for an
 * answer whose turn the server kept a trace of (`answer.ask_id`): a rating
 * has nothing to be recorded against otherwise.
 */
function AnswerActions({
  askId,
  answer,
  busy = false,
  onThinkHarder,
}: {
  /** The turn's id, which Report this names. */
  askId: string;
  answer: AskAnswer;
  /** Another turn is being answered, so asking this one again waits. */
  busy?: boolean;
  /** Set where this answer offers Think harder (`askOffersThinkHarder`). */
  onThinkHarder?: () => void;
}) {
  const target = {
    subject: "ask_answer" as const,
    subjectId: askId,
    receipt: answer.report_receipt ?? null,
  };
  const thumbs = useAskThumbs(answer.ask_id);
  // One answer, two ways to report it: the flag and a thumbs down's offer.
  const [reported, setReported] = useState(false);
  return (
    <div className="space-y-2">
      <div className="-ml-2 flex items-center">
        {answer.status === "answered" && answer.text ? (
          <CopyAnswer text={answer.text} />
        ) : null}
        {answer.ask_id ? (
          <AskThumbButtons
            rating={thumbs.state.rating}
            onRate={thumbs.rate}
            className={QUIET_ACTION}
          />
        ) : null}
        {onThinkHarder ? (
          <IconButton
            label={ASK_EFFORT_COPY.action}
            className={QUIET_ACTION}
            disabled={busy}
            onClick={onThinkHarder}
          >
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        ) : null}
        <ReportAiButton
          iconOnly
          className={QUIET_ACTION}
          target={target}
          reported={reported}
        />
      </div>
      {answer.ask_id ? (
        <AskThumbsFollowUp
          key={thumbs.state.rating ?? "none"}
          state={thumbs.state}
          failed={thumbs.failed}
          onReason={thumbs.giveReason}
          target={target}
          reported={reported}
          onReported={() => setReported(true)}
        />
      ) : null}
    </div>
  );
}

/** Copies the answer's words, without the markers. */
function CopyAnswer({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard(
    "Select the answer and copy it manually.",
  );
  return (
    <IconButton
      label={copied ? ASK_COPY.copied_answer : ASK_COPY.copy_answer}
      className={QUIET_ACTION}
      // The words as read, without the markdown's delimiters (#5429).
      onClick={() => void copy(askPlainWords(text))}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </IconButton>
  );
}

function AskAnswerBody({
  answer,
  busy,
  onAnswerConsent,
  onRetry,
  onFollowMessage,
}: {
  answer: AskAnswer;
  busy: boolean;
  onAnswerConsent: () => void;
  /** Asks the same question again in this turn's place. */
  onRetry: () => void;
  onFollowMessage?: () => void;
}) {
  if (answer.status === "unavailable") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">
          {askUnavailableLine(answer.reason)}
        </p>
        {answer.reason === "consent_required" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onAnswerConsent}
          >
            {ASK_COPY.consent_action}
          </Button>
        ) : null}
        {/* A problem on Frapp's side, or a reason this build does not
            know: asking again is all a member can do (#5082). The other
            reasons say what to do or when. */}
        {askUnavailableOffersRetry(answer.reason) ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onRetry}
          >
            {ASK_COPY.try_again}
          </Button>
        ) : null}
      </div>
    );
  }
  if (answer.status === "refused") {
    return <p className="text-sm text-foreground">{ASK_COPY.refused}</p>;
  }
  if (answer.status === "not_found") {
    return (
      <div className="space-y-1">
        <p className="text-sm text-foreground">{ASK_COPY.not_found}</p>
        <p className="text-caption text-muted-foreground">
          {ASK_COPY.not_found_hint}
        </p>
        <AnswerNotes answer={answer} />
      </div>
    );
  }
  const body = (
    <>
      {/* An answer that is cards and nothing else has no words to draw. */}
      {answer.text ? (
        <AnswerText answer={answer} onFollowMessage={onFollowMessage} />
      ) : null}
      {/* A sentence that rests on no source says so, where a source would be. */}
      {answer.own_words ? (
        <p className="text-caption text-muted-foreground">
          {ASK_COPY.own_words}
        </p>
      ) : null}
      <AnswerNotes answer={answer} />
      {answer.sources.length > 0 ? (
        <ol aria-label={ASK_COPY.sources} className="flex flex-wrap gap-1.5">
          {answer.sources.map((source, index) => (
            <SourceChip
              key={source.id}
              number={index + 1}
              source={source}
              onFollowMessage={onFollowMessage}
            />
          ))}
        </ol>
      ) : null}
    </>
  );
  return answer.ask_id ? (
    <CountSourceOpens askId={answer.ask_id}>{body}</CountSourceOpens>
  ) : (
    body
  );
}

/**
 * Called when a source under this answer is opened, by its chip or by a
 * marker; null where there is nothing to count against.
 */
const SourceOpened = createContext<(() => void) | null>(null);

/**
 * Counts each source opened under an answer the server kept a trace of
 * (`source_opened`, `spec/behavior/ai.md` § Feedback on an answer). One word
 * against the answer's id; which source, and what it says, are not sent.
 */
function CountSourceOpens({
  askId,
  children,
}: {
  askId: string;
  children: ReactNode;
}) {
  const signal = useAskSignal();
  return (
    <SourceOpened.Provider value={() => signal(askId, "source_opened")}>
      {children}
    </SourceOpened.Provider>
  );
}

/**
 * An answer its asker posted to a channel (#4713), for everyone who reads
 * it: the same words, markers and chips the asker saw, so an answer reads
 * one way wherever it is. What differs is what the channel is owed. A marker
 * shows its source's name and not the quoted passage, which stays with the
 * asker; the asker's own records are named as theirs and open nothing, since
 * a reader's Tasks page is their own; and a line says so when some sources
 * were not open to everyone when it was posted.
 */
export function AskPostedBody({
  text,
  posted,
  askerName,
}: {
  /** The row's `content`: the answer's words, which the markers count into. */
  text: string;
  posted: AskPostedAnswer;
  /** The asker's roster name, or null when the roster can't name them. */
  askerName: string | null;
}) {
  const sources: AskSource[] = posted.sources.map((source, index) => ({
    id: String(index),
    kind: source.kind,
    title: askPostedSourceTitle(source, askerName),
    detail: source.detail,
    date: source.date,
    target: source.target,
  }));
  const marker = (placed: AskMarker) => (
    <CitationMarker
      number={placed.source + 1}
      source={sources[placed.source]}
      quote=""
    />
  );
  const notes: string[] = [
    ...(posted.truncated ? [ASK_COPY.truncated] : []),
    ...(posted.sources.some((source) => source.limited)
      ? [ASK_POST_COPY.limited]
      : []),
  ];
  return (
    <div className="space-y-2">
      <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        <AskMarkdown
          text={text}
          citations={posted.citations}
          entities={NO_ENTITIES}
          marker={marker}
        />
      </div>
      {sources.length > 0 ? (
        <ol aria-label={ASK_COPY.sources} className="flex flex-wrap gap-1.5">
          {sources.map((source, index) => (
            <SourceChip key={source.id} number={index + 1} source={source} />
          ))}
        </ol>
      ) : null}
      {notes.length > 0 ? (
        <ul className="space-y-1 text-caption text-muted-foreground">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A posted answer carries no names to draw. */
const NO_ENTITIES: readonly AskEntity[] = [];

/** What the member should know before relying on the answer. Each only when true. */
function AnswerNotes({ answer }: { answer: AskAnswer }) {
  const notes = [
    answer.unverified_citations > 0 ? ASK_COPY.unverified : null,
    answer.truncated ? ASK_COPY.truncated : null,
    answer.left_out_messages > 0
      ? askLeftOutLine(answer.left_out_messages)
      : null,
  ].filter((note): note is string => note !== null);
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-caption text-muted-foreground">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

/**
 * The answer's own words, drawn as markdown (#5429, `ask-markdown.tsx`):
 * each cited sentence ends in its marker, and a person or channel the server
 * named is drawn as chat draws a mention. With no names listed, as from a
 * server before the agent build, it is the text and its markers.
 */
function AnswerText({
  answer,
  onFollowMessage,
}: {
  answer: AskAnswer;
  onFollowMessage?: () => void;
}) {
  const entities = askAnswerEntities(answer);
  const marker = (placed: AskMarker) => (
    <CitationMarker
      number={placed.source + 1}
      source={answer.sources[placed.source]}
      quote={answer.citations[placed.index]?.quote ?? ""}
      onFollowMessage={onFollowMessage}
    />
  );
  const draw = (canOpenChannel: (channelId: string) => boolean) => (
    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
      <AskMarkdown
        text={answer.text}
        citations={answer.citations}
        entities={entities}
        marker={marker}
        canOpenChannel={canOpenChannel}
        onFollow={onFollowMessage}
      />
    </div>
  );
  // The reader's channel list is only read for an answer that names one.
  return entities.some((entity) => entity.type === "channel") ? (
    <AskChannelOpens>{draw}</AskChannelOpens>
  ) : (
    draw(() => false)
  );
}

/**
 * Ask's fixed gold: the marker is Frapp's, so it never takes the chapter
 * accent, as the member's own bubble, send and Confirm do
 * (`components.md` §11).
 */
const MARKER =
  "mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] border border-gold-ask-border bg-gold-ask-fill px-1 align-[1px] text-caption font-bold leading-none text-gold-ask-text no-underline";

function CitationMarker({
  number,
  source,
  quote,
  onFollowMessage,
}: {
  number: number;
  source: AskSource | undefined;
  quote: string;
  onFollowMessage?: () => void;
}) {
  const opened = useContext(SourceOpened);
  if (!source) return null;
  const href = askSourceHref(source);
  const backworkId = askSourceBackworkId(source);
  const { name } = askSourceChip(source);
  const label = `Source ${number}: ${name}`;
  // The words the server found in the source, on hover, so the member can
  // check the claim before opening anything.
  const title = quote ? `${name}: "${quote}"` : name;
  if (backworkId) {
    return (
      <BackworkDownload
        backworkId={backworkId}
        onStart={opened}
        className={cn(MARKER, "hover:bg-gold-ask-border/30", FOCUS_RING)}
        label={`${label}. Download`}
        title={title}
      >
        {() => number}
      </BackworkDownload>
    );
  }
  if (!href) {
    return (
      <span className={MARKER} aria-label={label} title={title}>
        {number}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={cn(MARKER, "hover:bg-gold-ask-border/30", FOCUS_RING)}
      aria-label={label}
      title={title}
      onClick={(event) => {
        opened?.();
        if (askSourceIsMessage(source)) onPlainClick(onFollowMessage)?.(event);
      }}
    >
      {number}
    </Link>
  );
}

/**
 * One source as a chip: the number its markers carry, then its name. What
 * kind of source it is and its date are the chip's tooltip and its
 * accessible name, so a thread of several answers stays short.
 */
function SourceChip({
  number,
  source,
  onFollowMessage,
}: {
  number: number;
  source: AskSource;
  onFollowMessage?: () => void;
}) {
  const opened = useContext(SourceOpened);
  const href = askSourceHref(source);
  const backworkId = askSourceBackworkId(source);
  // A quoted message says whose it is and when (`askSourceChip`, #4904).
  const { name: words, when, meta } = askSourceChip(source);
  const name = [`Source ${number}: ${words}`, meta].filter(Boolean).join(", ");
  const chip =
    "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-1 pl-2.5 pr-3 text-caption pointer-coarse:h-11";
  const body = (pending: boolean) => (
    <>
      <span
        aria-hidden="true"
        className="shrink-0 font-bold tabular-nums text-gold-ask-text"
      >
        {number}
      </span>
      <span className="min-w-0 truncate font-medium text-foreground">
        {words}
      </span>
      {when ? (
        <span className="shrink-0 text-muted-foreground">{when}</span>
      ) : null}
      {backworkId ? (
        // The file downloads (#5209). While its link is fetched the arrow
        // turns to a spinner of the same size, so nothing in the row moves.
        pending ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
          />
        ) : (
          <Download
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )
      ) : null}
    </>
  );
  return (
    <li className="min-w-0 max-w-full">
      {backworkId ? (
        <BackworkDownload
          backworkId={backworkId}
          onStart={opened}
          className={cn(
            chip,
            "transition-colors hover:bg-card-hover",
            FOCUS_RING,
          )}
          label={`${name}. Download`}
          title={meta}
        >
          {body}
        </BackworkDownload>
      ) : href ? (
        <Link
          href={href}
          aria-label={name}
          title={meta}
          onClick={(event) => {
            opened?.();
            if (askSourceIsMessage(source)) {
              onPlainClick(onFollowMessage)?.(event);
            }
          }}
          className={cn(
            chip,
            "transition-colors hover:bg-card-hover",
            FOCUS_RING,
          )}
        >
          {body(false)}
        </Link>
      ) : (
        <span className={chip} aria-label={name} title={meta}>
          {body(false)}
        </span>
      )}
    </li>
  );
}

/**
 * A backwork file Frapp found, as a button that downloads it (#5209): a
 * chip or a marker. Its own component so the fetch it needs is only set up
 * where a file is shown. `children` is drawn with whether the link is being
 * fetched, for a pending state that keeps its size.
 */
function BackworkDownload({
  backworkId,
  onStart,
  className,
  label,
  title,
  children,
}: {
  backworkId: string;
  onStart: (() => void) | null;
  className: string;
  label: string;
  title: string;
  children: (pending: boolean) => ReactNode;
}) {
  const { download, pendingId } = useAskBackworkDownload();
  const pending = pendingId === backworkId;
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-busy={pending}
      title={title}
      onClick={() => {
        if (pending) return;
        onStart?.();
        void download(backworkId);
      }}
    >
      {children(pending)}
    </button>
  );
}
