"use client";

import Link from "next/link";
import type {
  ActResponse,
  AskExchange,
  AskProposalResolution,
} from "@repo/hooks";
import {
  ASK_COPY,
  askAnswerSegments,
  askLeftOutLine,
  askSourceMetaLine,
  askStepLine,
  askUnavailableLine,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { AskProposal } from "@/components/ask/ask-proposal";
import { askSourceHref } from "@/components/ask/ask-source-link";
import { ReportAiButton } from "@/components/ai/report-ai";

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
 * your chapter's sources") sits under the text, in the place the notes and
 * sources take when the answer lands, so text streams in above it and the
 * question never shifts. The streamed text is a preview: the server decides
 * what stands after the model stops, and `done` replaces it (`ask.ts`).
 */
export function AskTurn({
  exchange,
  busy = false,
  onRetry,
  onAnswerConsent,
  onFollowSource,
  onProposal,
  onResolved,
}: {
  exchange: AskExchange;
  /**
   * Another turn is being answered. Asking this one again would abandon it,
   * so this turn's Try again and consent buttons wait.
   */
  busy?: boolean;
  /** A link out of the panel was followed, for a panel that then gets out of the way. */
  onFollowSource?: () => void;
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
      <h3 className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-[6px] bg-surface-1 px-3.5 py-2 text-sm font-normal text-foreground">
        {exchange.question}
      </h3>
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
            <p className="text-sm text-foreground">
              {exchange.failure.message}
            </p>
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
            onLeave={onFollowSource}
          />
        ) : null}
        {exchange.phase === "done" && exchange.answer ? (
          <>
            <AskAnswerBody
              answer={exchange.answer}
              busy={busy}
              onAnswerConsent={onAnswerConsent}
              onFollowSource={onFollowSource}
            />
            {/* Anything Ask wrote, or chose not to, can be reported. An
                answer that was never attempted has nothing AI-made in it. */}
            {exchange.answer.status !== "unavailable" && exchange.askId ? (
              <div className="-ml-2 flex">
                <ReportAiButton
                  key={exchange.askId}
                  target={{
                    subject: "ask_answer",
                    subjectId: exchange.askId,
                    receipt: exchange.answer.report_receipt ?? null,
                  }}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}

function AskAnswerBody({
  answer,
  busy,
  onAnswerConsent,
  onFollowSource,
}: {
  answer: AskAnswer;
  busy: boolean;
  onFollowSource?: () => void;
  onAnswerConsent: () => void;
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
  return (
    <>
      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
        {askAnswerSegments(answer).map((segment, position) =>
          segment.type === "text" ? (
            <span key={position}>{segment.text}</span>
          ) : (
            <CitationMarker
              key={position}
              number={segment.citation.source + 1}
              source={answer.sources[segment.citation.source]}
              quote={segment.citation.quote}
              onFollow={onFollowSource}
            />
          ),
        )}
      </p>
      <AnswerNotes answer={answer} />
      {answer.sources.length > 0 ? (
        <ol aria-label={ASK_COPY.sources} className="flex flex-wrap gap-1.5">
          {answer.sources.map((source, index) => (
            <SourceChip
              key={source.id}
              number={index + 1}
              source={source}
              onFollow={onFollowSource}
            />
          ))}
        </ol>
      ) : null}
    </>
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
 * Ask's fixed gold, as the pill: the marker is Ask speaking, never the
 * chapter accent (`components.md` §7).
 */
const MARKER =
  "mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] border border-gold-ask-border bg-gold-ask-fill px-1 align-[1px] text-caption font-bold leading-none text-gold-ask-text no-underline";

function CitationMarker({
  number,
  source,
  quote,
  onFollow,
}: {
  number: number;
  source: AskSource | undefined;
  quote: string;
  onFollow?: () => void;
}) {
  if (!source) return null;
  const href = askSourceHref(source);
  const label = `Source ${number}: ${source.title}`;
  // The words the server found in the source, on hover, so the member can
  // check the claim before opening anything.
  const title = quote ? `${source.title}: "${quote}"` : source.title;
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
      onClick={onFollow}
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
  onFollow,
}: {
  number: number;
  source: AskSource;
  onFollow?: () => void;
}) {
  const href = askSourceHref(source);
  const meta = askSourceMetaLine(source);
  const name = [`Source ${number}: ${source.title}`, meta]
    .filter(Boolean)
    .join(", ");
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
        {source.title}
      </span>
    </>
  );
  return (
    <li className="min-w-0 max-w-full">
      {href ? (
        <Link
          href={href}
          onClick={onFollow}
          aria-label={name}
          title={meta}
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
