"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  REPORT_ALREADY_BODY,
  REPORT_ALREADY_TITLE,
  REPORT_FORM_PROMPT,
  REPORT_FORM_TITLE,
  REPORT_REASON_OPTIONS,
  REPORT_SEND_LABEL,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  reportFailureBody,
} from "@repo/chat-core/report-copy";
import {
  CHAT_REPORT_DETAILS_MAX_LENGTH,
  useReportMessage,
  type ChatReportReason,
} from "@repo/hooks";
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

/** The message a report is being filed on. */
export interface ReportTarget {
  messageId: string;
  /**
   * Offered once the report is in, when the sender can be blocked
   * (`canBlockSender`): the step a member who reports abuse is likeliest to
   * want next, and the one App Review's guideline 1.2 asks to be reachable.
   */
  onBlock?: () => void;
  /** "Block Alex Chen", or `null` with `onBlock` unset. */
  blockLabel: string | null;
}

type Outcome = "sent" | "already";

/**
 * Report a message (#2687), web's half of mobile's report sheet. The reasons,
 * the outcomes and the failure wording are `@repo/chat-core/report-copy`'s, so
 * both clients tell a member the same thing about where a report goes.
 *
 * Keyed by the caller on `target.messageId`, so a second report never opens on
 * the last one's reason or its "Report sent".
 *
 * **It cannot be closed while the request is out.** Closing remounts it
 * through that key, which would throw the answer away: a failure would reach
 * no one, and a success would never say "Report sent" or offer Block. So
 * Cancel, the close button, Escape and the scrim all wait for the answer, which
 * is why web needs no "Couldn't send your report" alert after the form is gone.
 */
export function ReportMessageDialog({
  target,
  onClose,
}: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const report = useReportMessage();
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const detailsId = useId();

  async function submit() {
    if (!target || !reason || report.isPending) return;
    setFailure(null);
    try {
      const filed = await report.mutateAsync({
        messageId: target.messageId,
        reason,
        details,
      });
      setOutcome(filed.alreadyReported ? "already" : "sent");
    } catch (error) {
      setFailure(reportFailureBody(error));
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !report.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {outcome ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {outcome === "already"
                  ? REPORT_ALREADY_TITLE
                  : REPORT_SENT_TITLE}
              </DialogTitle>
              <DialogDescription>
                {outcome === "already" ? REPORT_ALREADY_BODY : REPORT_SENT_BODY}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {target?.onBlock && target.blockLabel ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    const block = target.onBlock;
                    onClose();
                    block?.();
                  }}
                >
                  {target.blockLabel}
                </Button>
              ) : null}
              <Button type="button" onClick={onClose}>
                Done
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
              <DialogTitle>{REPORT_FORM_TITLE}</DialogTitle>
              <DialogDescription>{REPORT_FORM_PROMPT}</DialogDescription>
            </DialogHeader>
            <fieldset className="flex flex-col" disabled={report.isPending}>
              <legend className="sr-only">Reason</legend>
              {REPORT_REASON_OPTIONS.map((option) => (
                <label
                  key={option.reason}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 text-sm",
                    "hover:bg-card-hover pointer-coarse:min-h-11",
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={option.reason}
                    checked={reason === option.reason}
                    onChange={() => setReason(option.reason)}
                    className="h-4 w-4 accent-primary"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={detailsId} className="text-sm font-medium">
                Details (optional)
              </label>
              <Textarea
                id={detailsId}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={CHAT_REPORT_DETAILS_MAX_LENGTH}
                disabled={report.isPending}
                className="min-h-[72px] resize-none"
              />
            </div>
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
                Cancel
              </Button>
              <Button type="submit" disabled={!reason || report.isPending}>
                {report.isPending ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {REPORT_SEND_LABEL}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
