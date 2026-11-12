"use client";

import { useId, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { codeOf } from "@repo/api-sdk";
import { useAiReportPolicy, useMyPermissions, useReportAi } from "@repo/hooks";
import {
  AI_REPORT_COPY,
  AI_REPORT_NOTE_MAX_LENGTH,
  AI_REPORT_REASONS,
  aiReportAttachedLine,
  can,
  type AiReportReason,
  type AiReportSubject,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** What is being reported: the subject, its id, and Ask's receipt. */
export interface AiReportTarget {
  subject: AiReportSubject;
  subjectId: string;
  /** Ask only: the answer's `report_receipt`, exactly as it came. */
  receipt?: string | null;
}

type Outcome = "sent" | "already";

/**
 * "Report this" under anything the AI made (#4315, `spec/behavior/ai.md`
 * § Stored AI text): an Ask answer, a drafted set of minutes, a suggested
 * task.
 *
 * It follows what members already know from reporting a message here
 * (`ReportMessageDialog`), and from the thumbs-down on a ChatGPT or Gemini
 * answer: a few reasons, an optional note, one Send. Unlike those, it says
 * before Send exactly what goes with the report, who reads it and for how
 * long, because this is the one place Frapp keeps AI text.
 *
 * The button keeps its size when it turns into "Reported", so nothing around
 * it moves.
 */
export function ReportAiButton({
  target,
  className,
  iconOnly = false,
  name,
}: {
  target: AiReportTarget;
  className?: string;
  /**
   * The flag alone, for a row that already carries its own icon actions
   * (a suggested task's Dismiss and Change), so the row stays one line.
   */
  iconOnly?: boolean;
  /** What is reported, for the icon's label: "Report Book the venue". */
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const permissions = useMyPermissions().data?.permissions;
  const label = reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action;
  // The report route asks for `ai:use`, as Ask does. A member without it
  // (a chapter from before AI, an alumnus) is not offered a report that
  // could never send. Held until known, the shell has usually loaded it.
  if (!permissions || !can("ai:use", permissions)) return null;
  return (
    <>
      {iconOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          aria-label={
            reported
              ? AI_REPORT_COPY.reported
              : name
                ? `Report ${name}`
                : AI_REPORT_COPY.titles[target.subject]
          }
          title={label}
          disabled={reported}
          onClick={() => setOpen(true)}
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("gap-1.5 px-2", className)}
          disabled={reported}
          onClick={() => setOpen(true)}
        >
          <Flag className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      )}
      {open ? (
        <ReportAiDialog
          target={target}
          onClose={() => setOpen(false)}
          onReported={() => setReported(true)}
        />
      ) : null}
    </>
  );
}

/**
 * The sheet itself. It cannot be closed while the report is out, like the
 * message report: closing would throw the answer away, and a failure would
 * reach no one.
 */
export function ReportAiDialog({
  target,
  onClose,
  onReported,
}: {
  target: AiReportTarget;
  onClose: () => void;
  onReported: () => void;
}) {
  const ids = useId();
  const policy = useAiReportPolicy();
  const report = useReportAi();
  const [reason, setReason] = useState<AiReportReason | null>(null);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // An answer from a server with no key carries no receipt; neither keeps
  // the text, and the sheet says so. Until the server has said, the line
  // keeps its place and Send waits, so the member never confirms unseen.
  // If the server's answer can't be read, the sheet says the most a report
  // could keep, so a member never sends more than they were told.
  const serverKeeps = policy.data
    ? policy.data.keeps_text
    : policy.isError || policy.data === null
      ? true
      : null;
  const keepsText =
    serverKeeps === null
      ? null
      : serverKeeps && (target.subject !== "ask_answer" || !!target.receipt);

  async function submit() {
    if (!reason || report.isPending || keepsText === null) return;
    setFailure(null);
    try {
      const filed = await report.mutateAsync({
        subject: target.subject,
        subjectId: target.subjectId,
        reason,
        note,
        receipt: target.receipt ?? null,
      });
      setOutcome(filed.already_reported ? "already" : "sent");
      onReported();
    } catch (error) {
      const code = codeOf(error);
      setFailure(
        code === "ai.report.too_old"
          ? AI_REPORT_COPY.too_old
          : code === "ai.report.receipt_invalid"
            ? AI_REPORT_COPY.receipt_invalid
            : code === "ai.report.not_found"
              ? AI_REPORT_COPY.gone
              : AI_REPORT_COPY.failed,
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !report.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {outcome ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {outcome === "already"
                  ? AI_REPORT_COPY.already_title
                  : AI_REPORT_COPY.sent_title}
              </DialogTitle>
              <DialogDescription>
                {outcome === "already"
                  ? AI_REPORT_COPY.already_body
                  : AI_REPORT_COPY.sent_body}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {AI_REPORT_COPY.done}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{AI_REPORT_COPY.titles[target.subject]}</DialogTitle>
              <DialogDescription>{AI_REPORT_COPY.who_reads}</DialogDescription>
            </DialogHeader>
            <fieldset className="flex flex-col" disabled={report.isPending}>
              <legend className="mb-1 text-sm font-medium">
                {AI_REPORT_COPY.prompt}
              </legend>
              {AI_REPORT_REASONS.map((option) => (
                <label
                  key={option}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm",
                    "hover:bg-card-hover pointer-coarse:min-h-11",
                  )}
                >
                  <input
                    type="radio"
                    name={`${ids}-reason`}
                    value={option}
                    checked={reason === option}
                    onChange={() => setReason(option)}
                    className="h-4 w-4 accent-primary"
                  />
                  {AI_REPORT_COPY.reasons[option]}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-note`} className="text-sm font-medium">
                {AI_REPORT_COPY.note_label}
              </label>
              <Textarea
                id={`${ids}-note`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={AI_REPORT_NOTE_MAX_LENGTH}
                disabled={report.isPending}
                className="min-h-[72px] resize-none"
              />
            </div>
            {/* What goes with it, said before Send. Holds two lines of
                space while the server answers, so nothing jumps. */}
            <p
              className="min-h-10 text-caption text-muted-foreground"
              data-testid="ai-report-attached"
            >
              {keepsText === null
                ? null
                : aiReportAttachedLine(target.subject, keepsText)}
            </p>
            {failure ? (
              <p role="alert" className="text-sm text-destructive-text">
                {failure}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={report.isPending}
              >
                {AI_REPORT_COPY.cancel}
              </Button>
              <Button
                type="submit"
                disabled={!reason || report.isPending || keepsText === null}
              >
                {report.isPending ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {AI_REPORT_COPY.send}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
