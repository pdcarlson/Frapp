"use client";

import Link from "next/link";
import type { AskExchange } from "@repo/hooks";
import {
  ASK_COPY,
  askAnswerSegments,
  askLeftOutLine,
  askSourceMetaLine,
  askUnavailableLine,
  type AskAnswer,
  type AskSource,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { FOCUS_RING } from "@/components/ui/focus";
import { EYEBROW } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { askSourceHref } from "@/components/ask/ask-source-link";
import { ReportAiButton } from "@/components/ai/report-ai";

/**
 * One Ask exchange: the question, the answer with a numbered marker at each
 * cited sentence, and the sources those markers open (#451).
 *
 * The markers and the list follow what members already read elsewhere: Notion
 * AI and Perplexity put a small numbered chip at the end of the sentence it
 * backs, and Slack AI lists the messages and files an answer drew on under
 * it. Both are here, and both open the source: the document in the viewer,
 * the minutes, the message in its channel, or the page live data came from.
 *
 * **Nothing above the fold moves while it works.** The step line ("Searching
 * your chapter's sources") sits under the text, in the place the notes and
 * sources take when the answer lands, so text streams in above it and the
 * question never shifts. The streamed text is a preview: the server decides
 * what stands after the model stops, and `done` replaces it (`ask.ts`).
 */
export function AskExchangeView({
  exchange,
  onRetry,
  onAnswerConsent,
  onFollowSource,
}: {
  exchange: AskExchange;
  /** A source link was followed, for a panel that then gets out of the way. */
  onFollowSource?: () => void;
  /** Asks the same question again, after a failure that may not repeat. */
  onRetry: () => void;
  /** Opens the AI sheet, for an answer refused because it is unanswered. */
  onAnswerConsent: () => void;
}) {
  return (
    <article className="space-y-3">
      <h3 className="rounded-md bg-surface-1 px-3 py-2 text-sm font-medium text-foreground">
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
            <p className="text-caption text-muted-foreground">
              {(ASK_COPY.steps as Record<string, string>)[exchange.step ?? ""] ??
                ASK_COPY.steps.searching}
            </p>
          </>
        ) : null}
        {exchange.phase === "failed" && exchange.failure ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">{exchange.failure.message}</p>
            {exchange.failure.retryable ? (
              <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
                {ASK_COPY.try_again}
              </Button>
            ) : null}
          </div>
        ) : null}
        {exchange.phase === "done" && exchange.answer ? (
          <>
            <AskAnswerBody
              answer={exchange.answer}
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
  onAnswerConsent,
  onFollowSource,
}: {
  answer: AskAnswer;
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
      <p className="whitespace-pre-wrap text-sm text-foreground">
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
        <section className="space-y-1.5">
          <h4 className={cn(EYEBROW, "text-muted-foreground")}>
            {ASK_COPY.sources}
          </h4>
          <ol className="space-y-1">
            {answer.sources.map((source, index) => (
              <SourceRow
                key={source.id}
                number={index + 1}
                source={source}
                onFollow={onFollowSource}
              />
            ))}
          </ol>
        </section>
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

function SourceRow({
  number,
  source,
  onFollow,
}: {
  number: number;
  source: AskSource;
  onFollow?: () => void;
}) {
  const href = askSourceHref(source);
  const body = (
    <>
      <span
        aria-hidden="true"
        className="mt-px w-5 shrink-0 text-caption font-bold tabular-nums text-gold-ask-text"
      >
        {number}
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm font-medium text-foreground">
          {source.title}
        </span>
        <span className="block break-words text-caption text-muted-foreground">
          {askSourceMetaLine(source)}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          onClick={onFollow}
          className={cn(
            "-mx-2 flex gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-card-hover",
            FOCUS_RING,
          )}
        >
          {body}
        </Link>
      ) : (
        <div className="-mx-2 flex gap-1 px-2 py-1.5">{body}</div>
      )}
    </li>
  );
}
