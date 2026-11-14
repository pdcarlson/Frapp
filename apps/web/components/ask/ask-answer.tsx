"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import {
  useAskSignal,
  useAskThumbs,
  type ActResponse,
  type AskExchange,
  type AskProposalResolution,
} from "@repo/hooks";
import {
  ASK_COPY,
  ASK_POST_COPY,
  askAnswerEntities,
  askAnswerSegments,
  askLeftOutLine,
  askPostedSourceTitle,
  askReadLine,
  askSourceChip,
  askStepLine,
  askUnavailableLine,
  type AskAnswer,
  type AskPostedAnswer,
  type AskSource,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { IconButton } from "@/components/ui/icon-button";
import { useCopyToClipboard } from "@/lib/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import {
  AskEntityText,
  AskChannelOpens,
  onPlainClick,
} from "@/components/ask/ask-entity-text";
import { AskProposal } from "@/components/ask/ask-proposal";
import {
  askSourceHref,
  askSourceIsMessage,
} from "@/components/ask/ask-source-link";
import { ReportAiButton } from "@/components/ai/report-ai";
import {
  AskThumbButtons,
  AskThumbsFollowUp,
} from "@/components/ask/ask-thumbs";

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
 * **Nothing above the fold moves while it works.** The step line ("Searching
 * your chapter's sources") sits under the text, so text streams in above it
 * and the question never shifts. The streamed text is a preview: the server
 * decides what stands after the model stops, and `done` replaces it
 * (`ask.ts`).
 *
 * **The answer is the loudest thing in its turn** (Paul, 2026-11-13: "there
 * just needs to be better hierarchy", "report shouldn't be so obvious", and
 * the conversation "should feel more agentic"). Under the words, in the step
 * line's place and in its quiet tone, a line says what Frapp read to write
 * them ("Read the events calendar and 3 sources"), the way ChatGPT keeps
 * "Thought for 12s" and Perplexity its count of sources. Then the source
 * chips. Last, two small muted icons, Copy and Report, as ChatGPT, Claude and
 * Gemini end an answer with a row of quiet icons. "Report this" was a
 * labelled button there, the only control under every answer, and read as
 * the thing to do next.
 */
export function AskTurn({
  exchange,
  busy = false,
  onFollowMessage,
  onRetry,
  onAnswerConsent,
  onProposal,
  onResolved,
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
  /** Asks the same thing again, after a failure that may not repeat. */
  onRetry: () => void;
  /** Opens the AI sheet, for a turn refused because it is unanswered. */
  onAnswerConsent: () => void;
  /** An event pick answered with a new proposal for this turn. */
  onProposal: (proposal: ActResponse) => void;
  /** This turn's card was confirmed or dismissed. */
  onResolved: (resolution: AskProposalResolution) => void;
}) {
  return (
    <article className="space-y-3">
      <h3 className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-[6px] bg-primary px-3.5 py-2 text-sm font-normal text-primary-foreground">
        {exchange.question}
      </h3>
      <AskReply
        exchange={exchange}
        busy={busy}
        onFollowMessage={onFollowMessage}
        onRetry={onRetry}
        onAnswerConsent={onAnswerConsent}
        onProposal={onProposal}
        onResolved={onResolved}
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
  onAnswerConsent,
  onProposal,
  onResolved,
}: {
  exchange: AskExchange;
  busy?: boolean;
  onFollowMessage?: () => void;
  onRetry: () => void;
  onAnswerConsent: () => void;
  onProposal: (proposal: ActResponse) => void;
  onResolved: (resolution: AskProposalResolution) => void;
}) {
  return (
    <div aria-live="polite" className="space-y-3">
      {exchange.phase === "working" ? (
        <>
          {exchange.preview ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {exchange.preview}
            </p>
          ) : null}
          {exchange.step ? (
            <p className="text-caption text-muted-foreground">
              {askStepLine(exchange.step, exchange.stepDetail)}
            </p>
          ) : null}
        </>
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
            readLine={askReadLine(exchange.read)}
            busy={busy}
            onAnswerConsent={onAnswerConsent}
            onFollowMessage={onFollowMessage}
          />
          {/* Anything Ask wrote, or chose not to, can be reported. An
                answer that was never attempted has nothing AI-made in it. */}
          {exchange.answer.status !== "unavailable" && exchange.askId ? (
            <AnswerActions
              key={exchange.askId}
              askId={exchange.askId}
              answer={exchange.answer}
            />
          ) : null}
        </>
      ) : null}
    </div>
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
 * Copy, the thumbs and Report under a finished answer, and under them what a
 * thumbs down opens (`ask-thumbs.tsx`). The thumbs are drawn only for an
 * answer whose turn the server kept a trace of (`answer.ask_id`): a rating
 * has nothing to be recorded against otherwise.
 */
function AnswerActions({
  askId,
  answer,
}: {
  /** The turn's id, which Report this names. */
  askId: string;
  answer: AskAnswer;
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
      onClick={() => void copy(text)}
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
  readLine,
  busy,
  onAnswerConsent,
  onFollowMessage,
}: {
  answer: AskAnswer;
  /** What Frapp read to write it (`askReadLine`), or null. */
  readLine: string | null;
  busy: boolean;
  onAnswerConsent: () => void;
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
      <AnswerText answer={answer} onFollowMessage={onFollowMessage} />
      {/* Where the step line was while it worked, in the same tone. */}
      {readLine ? (
        <p className="text-caption text-muted-foreground">{readLine}</p>
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
  const segments = askAnswerSegments({
    text,
    citations: posted.citations.map((citation) => ({ ...citation, quote: "" })),
  });
  const notes: string[] = [
    ...(posted.truncated ? [ASK_COPY.truncated] : []),
    ...(posted.sources.some((source) => source.limited)
      ? [ASK_POST_COPY.limited]
      : []),
  ];
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {segments.map((segment, position) =>
          segment.type === "text" ? (
            <span key={position}>{segment.text}</span>
          ) : (
            <CitationMarker
              key={position}
              number={segment.citation.source + 1}
              source={sources[segment.citation.source]}
              quote=""
            />
          ),
        )}
      </p>
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
 * The answer's own words: each cited sentence ends in its marker, and a
 * person or channel the server named is drawn as chat draws a mention
 * (`ask-entity-text.tsx`). With no names listed, as from a server before the
 * agent build, it is the text and its markers, as it was.
 */
function AnswerText({
  answer,
  onFollowMessage,
}: {
  answer: AskAnswer;
  onFollowMessage?: () => void;
}) {
  const entities = askAnswerEntities(answer);
  const draw = (canOpenChannel: (channelId: string) => boolean) => (
    <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
      {askAnswerSegments(answer).map((segment, position) =>
        segment.type === "text" ? (
          <span key={position}>
            <AskEntityText
              text={segment.text}
              entities={entities}
              canOpenChannel={canOpenChannel}
              onFollow={onFollowMessage}
            />
          </span>
        ) : (
          <CitationMarker
            key={position}
            number={segment.citation.source + 1}
            source={answer.sources[segment.citation.source]}
            quote={segment.citation.quote}
            onFollowMessage={onFollowMessage}
          />
        ),
      )}
    </p>
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
  const { name } = askSourceChip(source);
  const label = `Source ${number}: ${name}`;
  // The words the server found in the source, on hover, so the member can
  // check the claim before opening anything.
  const title = quote ? `${name}: "${quote}"` : name;
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
  // A quoted message says whose it is and when (`askSourceChip`, #4904).
  const { name: words, when, meta } = askSourceChip(source);
  const name = [`Source ${number}: ${words}`, meta].filter(Boolean).join(", ");
  const chip =
    "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-1 pl-2.5 pr-3 text-caption pointer-coarse:h-11";
  const body = (
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
    </>
  );
  return (
    <li className="min-w-0 max-w-full">
      {href ? (
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
          {body}
        </Link>
      ) : (
        <span className={chip} aria-label={name} title={meta}>
          {body}
        </span>
      )}
    </li>
  );
}
