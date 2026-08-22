"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import {
  useCreateServiceEntry,
  useDeleteServiceEntry,
  useGetServiceProofUrl,
  useMembers,
  useOrgConfig,
  useRequestServiceProofUploadUrl,
  useReviewServiceEntry,
  useServiceEntries,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { serviceStatusKind } from "@/components/service/service-status";
import type { ServiceStatus } from "@/components/service/service-status";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
} from "@repo/validation";
import { formatMinutesExact as formatDuration } from "@repo/formatting";

type ServiceEntry = {
  id: string;
  chapter_id: string;
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  proof_path: string | null;
  status: ServiceStatus;
  reviewed_by: string | null;
  review_comment: string | null;
  points_awarded: boolean;
  created_at: string;
};

type MemberSummary = {
  user_id?: string;
  display_name?: string | null;
};

export function ServiceHoursPage() {
  const { toast } = useToast();
  // Every write on `ServiceEntryController` (proof-upload-url, create, review,
  // delete) carries no `@FreeTier`, so they are all paid-ops behind the same
  // subscription guard — one gate covers the surface (#841). `GET
  // /service-entries/:id/proof-url` is a read and stays ungated.
  const gate = useSubscriptionGate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const entriesQuery = useServiceEntries();
  const membersQuery = useMembers();
  const createEntry = useCreateServiceEntry();
  const reviewEntry = useReviewServiceEntry();
  const deleteEntry = useDeleteServiceEntry();
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

  const entries = useMemo(
    () => asArray<ServiceEntry>(entriesQuery.data),
    [entriesQuery.data],
  );
  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) {
      if (m.user_id)
        map.set(String(m.user_id), m.display_name ?? "Unnamed member");
    }
    return map;
  }, [members]);

  const pending = useMemo(
    () =>
      entries
        .filter((e) => e.status === "PENDING")
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [entries],
  );
  const history = useMemo(
    () =>
      entries
        .filter((e) => e.status !== "PENDING")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries],
  );

  const logDialog = useGatedDialog(gate);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [draft, setDraft] = useState({
    date: new Date().toISOString().slice(0, 10),
    hours: "1",
    minutes: "0",
    description: "",
  });

  const requestProofUpload = useRequestServiceProofUploadUrl();
  // Explicit flag (not derived from the mutations' isPending) so the guard
  // also spans the storage PUT between them — otherwise Submit re-enables
  // mid-upload and a second click creates a duplicate entry.
  const [submitting, setSubmitting] = useState(false);

  // The file input unmounts (and so renders empty) on close, so a kept
  // proofFile would silently attach a stale file to the next entry. Keyed off
  // the dialog's open flag rather than a close handler: `useGatedDialog` also
  // closes the dialog when the subscription is revoked mid-flight, and that
  // path never runs through `setOpen`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- drop a leftover proof file when the log dialog closes (including gated auto-close)
    if (!logDialog.open) setProofFile(null);
  }, [logDialog.open]);

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const totalMinutes =
      Math.max(0, Number(draft.hours)) * 60 +
      Math.max(0, Number(draft.minutes));
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
        const signedUrl =
          signed && typeof signed === "object" && "signedUrl" in signed
            ? (signed as { signedUrl?: string }).signedUrl
            : null;
        const storagePath =
          signed && typeof signed === "object" && "storagePath" in signed
            ? (signed as { storagePath?: string }).storagePath
            : null;
        if (!signedUrl || !storagePath) {
          throw new Error(
            "Upload URL response missing signed URL or storage path.",
          );
        }
        const response = await fetch(signedUrl, {
          method: "PUT",
          body: proofFile,
          headers: {
            "content-type": contentType,
            "x-upsert": "true",
          },
        });
        if (!response.ok) {
          throw new Error(
            `Storage rejected upload (${response.status}). Proof accepts images/PDF up to ${MAX_UPLOAD_LABEL}.`,
          );
        }
        proofPath = storagePath;
      }
      await createEntry.mutateAsync({
        date: draft.date,
        duration_minutes: totalMinutes,
        description: draft.description.trim(),
        proof_path: proofPath,
      });
      toast({
        title: "Service entry submitted",
        description: "An admin will review and approve it for points.",
      });
      logDialog.setOpen(false);
      setDraft({
        date: new Date().toISOString().slice(0, 10),
        hours: "1",
        minutes: "0",
        description: "",
      });
    } catch (error) {
      toast({
        title: "Couldn't log service entry",
        description: getErrorMessage(
          error,
          "Confirm service:log permission and retry.",
        ),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function approve(entry: ServiceEntry) {
    try {
      await reviewEntry.mutateAsync({
        id: entry.id,
        body: { status: "APPROVED" },
      });
      toast({
        title: "Entry approved",
        description: "Points will be awarded per the chapter rate.",
      });
    } catch (error) {
      toast({
        title: "Couldn't approve entry",
        description: getErrorMessage(
          error,
          "Requires service:approve and an active PENDING status.",
        ),
        variant: "destructive",
      });
    }
  }

  async function reject(entry: ServiceEntry) {
    const result = await confirm({
      title: `Reject "${entry.description || "this entry"}"?`,
      description:
        "The member is notified, and the hours are not credited. They can submit the entry again.",
      confirmLabel: "Reject entry",
      tone: "destructive",
      comment: {
        label: "Comment for the member",
        placeholder: "Optional — why was this rejected?",
      },
    });
    // `null` is cancel; a confirmed empty box is still a rejection.
    if (result === null) return;
    try {
      await reviewEntry.mutateAsync({
        id: entry.id,
        body: {
          status: "REJECTED",
          review_comment: result.comment || undefined,
        },
      });
      toast({
        title: "Entry rejected",
        description: "The member was notified with your comment.",
      });
    } catch (error) {
      toast({
        title: "Couldn't reject entry",
        description: getErrorMessage(error, "Retry or check your permissions."),
        variant: "destructive",
      });
    }
  }

  const getProofUrl = useGetServiceProofUrl();

  async function viewProof(entry: ServiceEntry) {
    try {
      const data = await getProofUrl.mutateAsync(entry.id);
      const url =
        data && typeof data === "object" && "url" in data
          ? (data as { url?: string }).url
          : null;
      if (!url) throw new Error("No download URL returned.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Couldn't open proof",
        description: getErrorMessage(
          error,
          "Older entries may reference proof that was never uploaded.",
        ),
        variant: "destructive",
      });
    }
  }

  async function withdraw(entry: ServiceEntry) {
    const confirmed = await confirm({
      title: "Withdraw this pending service entry?",
      description: "You can always resubmit it.",
      confirmLabel: "Withdraw entry",
      tone: "destructive",
    });
    if (!confirmed) return;
    try {
      await deleteEntry.mutateAsync(entry.id);
      toast({
        title: "Entry withdrawn",
        description: "The pending entry was removed.",
      });
    } catch (error) {
      toast({
        title: "Couldn't withdraw entry",
        description: getErrorMessage(
          error,
          "Only PENDING entries can be withdrawn.",
        ),
        variant: "destructive",
      });
    }
  }

  if (entriesQuery.isPending) {
    return <LoadingState message="Loading service entries..." />;
  }

  if (entriesQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load service entries"
        description="Members see only their own entries; admins need service:approve to see every entry."
        onRetry={() => void entriesQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Service hours
          </h2>
          <p className="text-sm text-muted-foreground">
            Members log hours; admins approve them for service points. Approved
            hours also appear in chapter service reports.
          </p>
        </div>
        <Can permission="service:log">
          <Dialog {...logDialog.dialogProps}>
            <DialogTrigger asChild>
              <Button className="gap-2" {...gate.controlProps()}>
                <Plus className="h-4 w-4" /> Log service
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg" {...logDialog.contentProps}>
              <DialogHeader>
                <DialogTitle>Log service hours</DialogTitle>
                <DialogDescription>
                  Submit a service entry for admin approval. Attach a photo or
                  PDF as proof of your service.
                </DialogDescription>
              </DialogHeader>
              <form
                id="service-log-form"
                onSubmit={submitDraft}
                className="space-y-4"
              >
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
                      value={draft.hours}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          hours: event.target.value,
                        }))
                      }
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
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          minutes: event.target.value,
                        }))
                      }
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
                  <p className="text-xs text-muted-foreground">
                    Photo or PDF, up to 25MB.
                  </p>
                </div>
              </form>
              <DialogFooter>
                {/* Cancel only closes the dialog — gating the way out of a
                    surface the gate just blocked would be a trap. */}
                <Button
                  variant="secondary"
                  onClick={() => logDialog.setOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  form="service-log-form"
                  type="submit"
                  {...gate.controlProps(submitting)}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Submit for approval
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Can>
      </header>

      {/*
        Disable, don't hide (§5 rule 4): the review queue, history, and proof
        links stay readable for a lapsed chapter — only logging and reviewing
        stop, and this says why.
      */}
      <SubscriptionNotice gate={gate} feature="logging service hours" />

      <Can permission="service:approve">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review queue</CardTitle>
            <CardDescription>
              {pending.length} pending entr{pending.length === 1 ? "y" : "ies"}{" "}
              awaiting approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <EmptyState
                title="No pending entries"
                description="Approved or rejected entries appear in the History card below."
              />
            ) : (
              <ul className="divide-y divide-border/70">
                {pending.map((entry) => {
                  const name =
                    memberNameById.get(entry.user_id) ?? entry.user_id;
                  return (
                    <li
                      key={entry.id}
                      className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.date} ·{" "}
                          {formatDuration(entry.duration_minutes)}
                        </p>
                        <p className="mt-1 text-sm">{entry.description}</p>
                        {/* Deliberately ungated: the signed link comes from
                            `GET /v1/service-entries/:id/proof-url`, and
                            `enforceSubscription` returns early for GET — a
                            lapsed chapter can still read its own proof. */}
                        {entry.proof_path ? (
                          <Button
                            size="sm"
                            variant="link"
                            className="h-auto px-0 text-xs"
                            onClick={() => void viewProof(entry)}
                            disabled={getProofUrl.isPending}
                          >
                            View proof
                          </Button>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {/*
                          `PATCH /v1/service-entries/:id/review` is paid-ops
                          too, so review mirrors the same gate as the log
                          trigger. Gating only the member's submit would leave
                          the page claiming writes are blocked while still
                          offering two per row.
                        */}
                        <Button
                          size="sm"
                          onClick={() => void approve(entry)}
                          {...gate.controlProps(reviewEntry.isPending)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void reject(entry)}
                          {...gate.controlProps(reviewEntry.isPending)}
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </Can>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">History</CardTitle>
          <CardDescription>
            Approved and rejected entries you have permission to see.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 && pending.length === 0 ? (
            <EmptyState
              title="No service activity yet"
              description="Log your first service entry to build up chapter service hours."
            />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing reviewed yet — PENDING entries above haven&apos;t been
              approved or rejected.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {history.map((entry) => {
                const name = memberNameById.get(entry.user_id) ?? entry.user_id;
                return (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.date} · {formatDuration(entry.duration_minutes)}
                      </p>
                      <p className="text-sm">{entry.description}</p>
                      {entry.review_comment ? (
                        <p className="text-xs text-muted-foreground">
                          Reviewer note: {entry.review_comment}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={serviceStatusKind(entry.status)}>
                        {entry.status}
                      </Badge>
                      {entry.points_awarded ? (
                        <Badge variant="outline">Points awarded</Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Approved hours automatically award service points at your
          chapter&apos;s configured rate. Withdrawing a rejected entry is
          allowed — create a fresh one when ready.
        </CardFooter>
      </Card>

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your pending entries</CardTitle>
            <CardDescription>
              Withdraw any pending entry if you submitted it by mistake.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/70">
              {pending.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    {entry.date} · {formatDuration(entry.duration_minutes)} ·{" "}
                    {entry.description}
                  </span>
                  {/* DELETE /v1/service-entries/:id sits behind the same
                      guard as the submit that created the entry. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void withdraw(entry)}
                    {...gate.controlProps()}
                  >
                    Withdraw
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {confirmDialog}
    </div>
  );
}
