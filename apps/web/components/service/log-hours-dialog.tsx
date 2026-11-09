"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  putSignedUpload,
  useCreateServiceEntry,
  useOrgConfig,
  useRequestServiceProofUploadUrl,
} from "@repo/hooks";
import type { DispatchResult, HoursInput } from "@repo/chat-core/dispatch";
import { localIsoDate } from "@repo/formatting";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SubscriptionNotice,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import {
  getErrorMessage,
  guardDecimalDraft,
  guardIntDraft,
  parseGuardedDecimal,
  parseGuardedInt,
} from "@/lib/utils";

function emptyDraft() {
  return {
    date: localIsoDate(new Date()),
    hours: "1",
    minutes: "0",
    description: "",
  };
}

type LogHoursDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every service-entry write is paid-ops (#841); the host owns the gate. */
  gate: SubscriptionGate;
  /** Rendered as the dialog's trigger (the Service page's Log service button). */
  trigger?: ReactNode;
  /**
   * Render the gate's notice inside the dialog. Only for a host that has no
   * notice of its own on screen (the chat +): the Service page shows one, and
   * a second, sharing the gate's id and ref, would steal the focus
   * `useGatedDialog` hands the notice when a block closes the dialog.
   */
  showSubscriptionNotice?: boolean;
  /** `useGatedDialog`'s `contentProps.onCloseAutoFocus`, when the host has one. */
  onCloseAutoFocus?: (event: Event) => void;
  /**
   * The chat composer's + menu (#3865): post the entry through chat, so its
   * hours card lands in the channel the form was opened in, as `/hours log`'s
   * does. `{ ok: false }` keeps the dialog open with the draft; anything else
   * closes it, and the host reports a warning. Without it the entry is
   * created with no card, as on the Service page.
   */
  submitToChannel?: (input: HoursInput) => Promise<DispatchResult>;
};

/**
 * Log service hours: date, duration, what was done, and proof when the
 * chapter's `wf_hours_receipt` workflow asks for it. The Service page's Log
 * service button and the chat composer's + menu open the same form.
 */
export function LogHoursDialog({
  open,
  onOpenChange,
  gate,
  trigger,
  onCloseAutoFocus,
  showSubscriptionNotice = false,
  submitToChannel,
}: LogHoursDialogProps) {
  const { toast } = useToast();
  const createEntry = useCreateServiceEntry();
  const requestProofUpload = useRequestServiceProofUploadUrl();
  const orgConfig = useOrgConfig();

  // Chapter policy (Settings → Workflows): when wf_hours_receipt is enabled
  // the API rejects proof-less submissions. GET /chapters/:id/config needs
  // chapter-config:view, which regular members don't hold — so only claim
  // "required"/"optional" when the config actually loaded, and stay neutral
  // otherwise. The server is the enforcement point either way.
  const receiptWorkflow = orgConfig.data?.workflows?.find(
    (wf) => wf.key === "wf_hours_receipt",
  );
  const receiptRequired = receiptWorkflow?.enabled === true;
  const proofLabel = receiptRequired
    ? "Proof file (required by chapter policy)"
    : receiptWorkflow
      ? "Proof file (optional)"
      : "Proof file";

  const [proofFile, setProofFile] = useState<File | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  // Explicit flag (not derived from the mutations' isPending) so the guard
  // also spans the storage PUT between them — otherwise Submit re-enables
  // mid-upload and a second click creates a duplicate entry.
  const [submitting, setSubmitting] = useState(false);

  // The file input unmounts (and so renders empty) on close, so a kept
  // proofFile would silently attach a stale file to the next entry. Keyed off
  // the open flag rather than a close handler: `useGatedDialog` also closes
  // the dialog when the subscription is revoked mid-flight, and that path
  // never runs through `onOpenChange`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop a leftover proof file when the log dialog closes (including gated auto-close)
    if (!open) setProofFile(null);
  }, [open]);

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    // Both drafts are "" or a nonnegative number (guarded on every
    // keystroke), so an empty or invalid duration sums to 0 and is refused
    // below rather than reaching the API as NaN. Hours take a decimal, as on
    // mobile (`1.5` is 90 minutes), and round to the whole minute the API
    // stores.
    const totalMinutes =
      Math.round((parseGuardedDecimal(draft.hours) ?? 0) * 60) +
      (parseGuardedInt(draft.minutes) ?? 0);
    if (totalMinutes === 0) {
      toast({
        title: "Enter a duration",
        description: "Service entries need at least one minute of time.",
        variant: "destructive",
      });
      return;
    }
    const proofInspected = proofFile
      ? inspectUploadFile("proof", proofFile)
      : undefined;
    if (proofFile && proofInspected && !proofInspected.ok) {
      toast({
        title:
          proofInspected.reason === "size"
            ? "File too large"
            : "File type not allowed",
        description:
          proofInspected.reason === "size"
            ? `Proof accepts photos or a PDF up to ${MAX_UPLOAD_LABEL}.`
            : "Proof accepts photos (JPG, PNG, GIF, WebP) or a PDF.",
        variant: "destructive",
      });
      return;
    }
    const proofContentType =
      proofInspected && proofInspected.ok
        ? proofInspected.contentType
        : undefined;
    setSubmitting(true);
    try {
      let proofPath: string | undefined;
      if (proofFile && proofContentType) {
        const contentType = proofContentType;
        const signed = await requestProofUpload.mutateAsync({
          filename: proofFile.name,
          content_type: contentType,
        });
        const { signedUrl, storagePath } = readSignedUpload(signed);
        await putSignedUpload({
          signedUrl,
          body: proofFile,
          contentType,
          upsert: true,
          describeRejection: () =>
            `The proof didn't upload. Use a photo or PDF up to ${MAX_UPLOAD_LABEL}.`,
        });
        proofPath = storagePath;
      }
      const input: HoursInput = {
        date: draft.date,
        duration_minutes: totalMinutes,
        description: draft.description.trim(),
        proof_path: proofPath,
      };
      if (submitToChannel) {
        const result = await submitToChannel(input);
        if (!result.ok) {
          toast({
            title: "Couldn't log service entry",
            description: result.error ?? "Try again in a moment.",
            variant: "destructive",
          });
          return;
        }
      } else {
        await createEntry.mutateAsync(input);
        toast({
          title: "Service entry submitted",
          description: "An admin will review and approve it for points.",
        });
      }
      onOpenChange(false);
      setDraft(emptyDraft());
    } catch (error) {
      toast({
        title: "Couldn't log service entry",
        description: getErrorMessage(error, "Try again in a moment."),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>Log service hours</DialogTitle>
          <DialogDescription>
            An admin approves it before points are awarded.
          </DialogDescription>
        </DialogHeader>
        {showSubscriptionNotice ? (
          <SubscriptionNotice gate={gate} feature="logging service hours" />
        ) : null}
        <form id="service-log-form" onSubmit={submitDraft} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="service-date">Date</Label>
              <Input
                id="service-date"
                type="date"
                value={draft.date}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    date: event.target.value,
                  }))
                }
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="service-hours">Hours</Label>
              <Input
                id="service-hours"
                type="number"
                min={0}
                step="any"
                value={draft.hours}
                onChange={(event) => {
                  const next = guardDecimalDraft(event.target.value);
                  if (next === undefined) return;
                  setDraft((prev) => ({ ...prev, hours: next }));
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="service-minutes">Minutes</Label>
              <Input
                id="service-minutes"
                type="number"
                min={0}
                max={59}
                value={draft.minutes}
                onChange={(event) => {
                  const next = guardIntDraft(event.target.value);
                  if (next === undefined) return;
                  setDraft((prev) => ({ ...prev, minutes: next }));
                }}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="service-description">What did you do?</Label>
            <Textarea
              id="service-description"
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              required
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="service-proof">{proofLabel}</Label>
            <Input
              id="service-proof"
              type="file"
              accept={acceptAttribute("proof")}
              onChange={(event) =>
                setProofFile(event.target.files?.[0] ?? null)
              }
              required={receiptRequired}
            />
            <p className="text-caption text-muted-foreground">
              Photo or PDF, up to {MAX_UPLOAD_LABEL}.
            </p>
          </div>
        </form>
        <DialogFooter>
          {/* Cancel only closes the dialog — gating the way out of a
              surface the gate just blocked would be a trap. */}
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            form="service-log-form"
            type="submit"
            {...gate.controlProps(submitting)}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
