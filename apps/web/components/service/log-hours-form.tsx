"use client";

import { useId, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SubscriptionNotice,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  FieldError,
  FormFooter,
  fieldClass,
  primarySize,
  useReportDraft,
  type FormLayout,
} from "@/components/shared/short-form";
import { useToast } from "@/lib/hooks/use-toast";
import {
  getErrorMessage,
  guardDecimalDraft,
  guardIntDraft,
  parseGuardedDecimal,
  parseGuardedInt,
} from "@/lib/utils";

/** Everything the form holds, kept by the + card while it is closed. */
export interface HoursDraft {
  date: string;
  hours: string;
  minutes: string;
  description: string;
  /** Kept with the draft, so a closed card doesn't drop a picked file. */
  proofFile: File | null;
}

function emptyHoursDraft(): HoursDraft {
  return {
    date: localIsoDate(new Date()),
    hours: "1",
    minutes: "0",
    description: "",
    proofFile: null,
  };
}

type Problems = {
  date?: string;
  duration?: string;
  description?: string;
  proof?: string;
};

export interface LogHoursFormProps {
  layout: FormLayout;
  /** Every service-entry write is paid-ops (#841); the host owns the gate. */
  gate: SubscriptionGate;
  /**
   * Render the gate's notice in the form. Only for a host that has no notice
   * of its own on screen (the chat +): the Service page shows one, and a
   * second, sharing the gate's id and ref, would steal the focus
   * `useGatedDialog` hands the notice when a block closes the dialog.
   */
  showSubscriptionNotice?: boolean;
  /**
   * The chat composer's + card (#3865, #3983): post the entry through chat,
   * so its hours card lands in the channel the form was opened in, as
   * `/hours log`'s does. `{ ok: false }` keeps the form open with the draft;
   * anything else is done, and the host reports a warning. Without it the
   * entry is created with no card, as on the Service page.
   */
  submitToChannel?: (input: HoursInput) => Promise<DispatchResult>;
  initialDraft?: HoursDraft;
  onDraftChange?: (draft: HoursDraft) => void;
  onDone: () => void;
  /** Cancel in the dialog, Discard draft in the card. */
  onCancel: () => void;
}

/**
 * Log service hours: date, duration, what was done, and proof when the
 * chapter's `wf_hours_receipt` workflow asks for it. One body for both hosts:
 * the Service page's Log service dialog and the chat composer's + card. A
 * missing or invalid field is outlined, named under it and focused on
 * submit, as the Task form does; only a write the server refuses toasts.
 */
export function LogHoursForm({
  layout,
  gate,
  showSubscriptionNotice = false,
  submitToChannel,
  initialDraft,
  onDraftChange,
  onDone,
  onCancel,
}: LogHoursFormProps) {
  const field = fieldClass(layout);
  const ids = useId();
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
    ? "Proof (required by your chapter)"
    : receiptWorkflow
      ? "Proof (optional)"
      : "Proof";

  const [draft, setDraft] = useState<HoursDraft>(
    () => initialDraft ?? emptyHoursDraft(),
  );
  useReportDraft(draft, onDraftChange);
  const edit = (patch: Partial<HoursDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));
  const [problems, setProblems] = useState<Problems>({});
  const clear = (key: keyof Problems) =>
    setProblems((previous) =>
      previous[key] ? { ...previous, [key]: undefined } : previous,
    );
  // Explicit flag (not derived from the mutations' isPending) so the guard
  // also spans the storage PUT between them — otherwise Submit re-enables
  // mid-upload and a second click creates a duplicate entry.
  const [submitting, setSubmitting] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const proofRef = useRef<HTMLButtonElement>(null);

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
    const proofInspected = draft.proofFile
      ? inspectUploadFile("proof", draft.proofFile)
      : undefined;
    const next: Problems = {
      date: draft.date ? undefined : "Pick the day you served.",
      duration:
        totalMinutes > 0 ? undefined : "Enter at least one minute of time.",
      description: draft.description.trim() ? undefined : "Say what you did.",
      proof:
        proofInspected && !proofInspected.ok
          ? proofInspected.reason === "size"
            ? `That file is too large. Use a photo or PDF up to ${MAX_UPLOAD_LABEL}.`
            : "Use a photo (JPG, PNG, GIF, WebP) or a PDF."
          : receiptRequired && !draft.proofFile
            ? "Your chapter needs proof with every entry."
            : undefined,
    };
    setProblems(next);
    if (next.date) return dateRef.current?.focus();
    if (next.duration) return hoursRef.current?.focus();
    if (next.description) return descriptionRef.current?.focus();
    if (next.proof) return proofRef.current?.focus();
    const proofContentType =
      proofInspected && proofInspected.ok
        ? proofInspected.contentType
        : undefined;
    setSubmitting(true);
    try {
      let proofPath: string | undefined;
      if (draft.proofFile && proofContentType) {
        const contentType = proofContentType;
        const signed = await requestProofUpload.mutateAsync({
          filename: draft.proofFile.name,
          content_type: contentType,
        });
        const { signedUrl, storagePath } = readSignedUpload(signed);
        await putSignedUpload({
          signedUrl,
          body: draft.proofFile,
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
      onDone();
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
    <form onSubmit={submitDraft} className="grid gap-3" noValidate>
      {showSubscriptionNotice ? (
        <SubscriptionNotice gate={gate} feature="logging service hours" />
      ) : null}
      {/*
        Date takes the row's first half and the duration the second: the
        cells hold `min-w-0`, so the date input's intrinsic width no longer
        pushes it over Hours (#3983, measured overlapping by 8px in the
        dialog).
      */}
      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <Label htmlFor={`${ids}-date`}>Date</Label>
          <DateField
            ref={dateRef}
            id={`${ids}-date`}
            lean="back"
            placeholder="e.g. Yesterday"
            data-plus-autofocus
            className={field}
            value={draft.date}
            aria-invalid={problems.date ? true : undefined}
            onChange={(date) => {
              edit({ date });
              clear("date");
            }}
          />
          {problems.date ? <FieldError>{problems.date}</FieldError> : null}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid min-w-0 grid-cols-1 gap-1">
              <Label htmlFor={`${ids}-hours`}>Hours</Label>
              <Input
                ref={hoursRef}
                id={`${ids}-hours`}
                type="number"
                min={0}
                step="any"
                className={field}
                value={draft.hours}
                aria-invalid={problems.duration ? true : undefined}
                onChange={(event) => {
                  const next = guardDecimalDraft(event.target.value);
                  if (next === undefined) return;
                  edit({ hours: next });
                  clear("duration");
                }}
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-1">
              <Label htmlFor={`${ids}-minutes`}>Minutes</Label>
              <Input
                id={`${ids}-minutes`}
                type="number"
                min={0}
                max={59}
                className={field}
                value={draft.minutes}
                aria-invalid={problems.duration ? true : undefined}
                onChange={(event) => {
                  const next = guardIntDraft(event.target.value);
                  if (next === undefined) return;
                  edit({ minutes: next });
                  clear("duration");
                }}
              />
            </div>
          </div>
          {problems.duration ? (
            <FieldError>{problems.duration}</FieldError>
          ) : null}
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-description`}>What did you do?</Label>
        <Textarea
          ref={descriptionRef}
          id={`${ids}-description`}
          rows={layout === "card" ? 2 : 3}
          value={draft.description}
          aria-invalid={problems.description ? true : undefined}
          onChange={(event) => {
            edit({ description: event.target.value });
            clear("description");
          }}
        />
        {problems.description ? (
          <FieldError>{problems.description}</FieldError>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${ids}-proof`}>{proofLabel}</Label>
        <ProofPicker
          inputRef={proofRef}
          id={`${ids}-proof`}
          file={draft.proofFile}
          invalid={Boolean(problems.proof)}
          layout={layout}
          onPick={(file) => {
            edit({ proofFile: file });
            clear("proof");
          }}
        />
        {problems.proof ? (
          <FieldError>{problems.proof}</FieldError>
        ) : (
          <p className="text-caption text-muted-foreground">
            Photo or PDF, up to {MAX_UPLOAD_LABEL}.
            {layout === "card"
              ? " An admin approves the entry before points are awarded."
              : null}
          </p>
        )}
      </div>
      <FormFooter
        layout={layout}
        onCancel={onCancel}
        cancelDisabled={submitting}
      >
        <Button
          type="submit"
          size={primarySize(layout)}
          {...gate.controlProps(submitting)}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit for approval
        </Button>
      </FormFooter>
    </form>
  );
}

/**
 * The proof field. A file input can't be given a file back, so the picked
 * file is shown by name beside a Choose button rather than by the browser's
 * own control, which would read "No file chosen" when a kept draft reopens.
 */
function ProofPicker({
  inputRef,
  id,
  file,
  invalid,
  layout,
  onPick,
}: {
  /** The Choose button: what the label names and what an error focuses. */
  inputRef: React.RefObject<HTMLButtonElement | null>;
  id: string;
  file: File | null;
  invalid: boolean;
  layout: FormLayout;
  onPick: (file: File | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const nameId = `${id}-name`;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        accept={acceptAttribute("proof")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="proof-file-input"
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          // Let the same file be picked again after Remove.
          event.target.value = "";
        }}
      />
      <Button
        ref={inputRef}
        id={id}
        type="button"
        variant="secondary"
        size={layout === "card" ? "sm" : "default"}
        className="shrink-0 aria-[invalid=true]:border-destructive"
        aria-invalid={invalid || undefined}
        aria-describedby={nameId}
        onClick={() => fileInput.current?.click()}
      >
        {file ? "Change" : "Choose file"}
      </Button>
      <span
        id={nameId}
        className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
      >
        {file ? file.name : "No file chosen"}
      </span>
      {file ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-label={`Remove ${file.name}`}
          onClick={() => onPick(null)}
        >
          Remove
        </Button>
      ) : null}
    </div>
  );
}
