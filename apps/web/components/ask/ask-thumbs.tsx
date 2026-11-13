"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { AskThumbsState } from "@repo/hooks";
import {
  ASK_FEEDBACK_COPY,
  ASK_FEEDBACK_REASONS,
  askFeedbackReportReason,
  type AskFeedbackRating,
  type AskFeedbackReason,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { ReportAiDialog, type AiReportTarget } from "@/components/ai/report-ai";

/**
 * The thumbs under an Ask answer (#4904, `spec/behavior/ai.md` § Feedback on
 * an answer), as ChatGPT, Claude and Gemini draw them: two quiet icons in the
 * answer's action row, the chosen one filled. Tapping the chosen one again
 * takes it back.
 */
export function AskThumbButtons({
  rating,
  onRate,
  className,
}: {
  rating: AskFeedbackRating | null;
  onRate: (rating: AskFeedbackRating) => void;
  className?: string;
}) {
  return (
    <>
      <IconButton
        label={ASK_FEEDBACK_COPY.up}
        aria-pressed={rating === "up"}
        className={cn(className, rating === "up" && "text-foreground")}
        onClick={() => onRate("up")}
      >
        <ThumbsUp
          className="h-3.5 w-3.5"
          fill={rating === "up" ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </IconButton>
      <IconButton
        label={ASK_FEEDBACK_COPY.down}
        aria-pressed={rating === "down"}
        className={cn(className, rating === "down" && "text-foreground")}
        onClick={() => onRate("down")}
      >
        <ThumbsDown
          className="h-3.5 w-3.5"
          fill={rating === "down" ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </IconButton>
    </>
  );
}

/**
 * What a thumbs opens under the action row. An up gets one line of thanks. A
 * down asks why in one tap, then says the rating carried none of the words
 * and offers to send the answer through Report this, which opens on the
 * reason already given. Nothing here is a typed box.
 *
 * "Not now" and a sent report both fold it back to the thanks line. It is
 * keyed by the rating where it is used, so a change of thumb starts it over.
 */
export function AskThumbsFollowUp({
  state,
  failed,
  onReason,
  target,
}: {
  state: AskThumbsState;
  failed: boolean;
  onReason: (reason: AskFeedbackReason) => void;
  target: AiReportTarget;
}) {
  const [sending, setSending] = useState(false);
  const [closed, setClosed] = useState(false);

  if (failed) {
    return (
      <p role="alert" className="text-caption text-destructive-text">
        {ASK_FEEDBACK_COPY.failed}
      </p>
    );
  }
  if (state.rating === null) return null;
  if (state.rating === "up" || closed) {
    return (
      <p role="status" className="text-caption text-muted-foreground">
        {ASK_FEEDBACK_COPY.thanks}
      </p>
    );
  }
  return (
    <div className="space-y-2" data-testid="ask-thumbs-follow-up">
      <div
        role="group"
        aria-label={ASK_FEEDBACK_COPY.prompt}
        className="flex flex-wrap items-center gap-1.5"
      >
        <span className="mr-1 text-caption text-muted-foreground">
          {ASK_FEEDBACK_COPY.prompt}
        </span>
        {ASK_FEEDBACK_REASONS.map((reason) => (
          <Button
            key={reason}
            type="button"
            size="sm"
            variant={state.reason === reason ? "tinted" : "secondary"}
            aria-pressed={state.reason === reason}
            className="h-7 rounded-full px-2.5 text-caption pointer-coarse:h-11"
            onClick={() => onReason(reason)}
          >
            {ASK_FEEDBACK_COPY.reasons[reason]}
          </Button>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">
        {ASK_FEEDBACK_COPY.send.line}{" "}
        <button
          type="button"
          className="font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => setSending(true)}
        >
          {ASK_FEEDBACK_COPY.send.action}
        </button>
        <span aria-hidden="true"> · </span>
        <button
          type="button"
          className="underline-offset-2 hover:underline"
          onClick={() => setClosed(true)}
        >
          {ASK_FEEDBACK_COPY.send.dismiss}
        </button>
      </p>
      {sending ? (
        <ReportAiDialog
          target={target}
          initialReason={askFeedbackReportReason(state.reason)}
          onClose={() => setSending(false)}
          onReported={() => setClosed(true)}
        />
      ) : null}
    </div>
  );
}
