"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, XCircle } from "lucide-react";
import {
  useCreateServiceEntry,
  useDeleteServiceEntry,
  useMembers,
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
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

type ServiceStatus = "PENDING" | "APPROVED" | "REJECTED";

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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function statusBadgeVariant(
  status: ServiceStatus,
): "default" | "outline" | "destructive" | "secondary" {
  switch (status) {
    case "APPROVED":
      return "default";
    case "PENDING":
      return "secondary";
    case "REJECTED":
      return "destructive";
    default:
      return "outline";
  }
}

export function ServiceHoursPage() {
  const { toast } = useToast();
  const entriesQuery = useServiceEntries();
  const membersQuery = useMembers();
  const createEntry = useCreateServiceEntry();
  const reviewEntry = useReviewServiceEntry();
  const deleteEntry = useDeleteServiceEntry();

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
      if (m.user_id) map.set(String(m.user_id), m.display_name ?? "Unnamed member");
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

  const [logOpen, setLogOpen] = useState(false);
  const [draft, setDraft] = useState({
    date: new Date().toISOString().slice(0, 10),
    hours: "1",
    minutes: "0",
    description: "",
    proof_path: "",
  });

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalMinutes =
      Math.max(0, Number(draft.hours)) * 60 + Math.max(0, Number(draft.minutes));
    if (totalMinutes === 0) {
      toast({
        title: "Enter a duration",
        description: "Service entries need at least one minute of time.",
        variant: "destructive",
      });
      return;
    }
    try {
      await createEntry.mutateAsync({
        date: draft.date,
        duration_minutes: totalMinutes,
        description: draft.description.trim(),
        proof_path: draft.proof_path || undefined,
      });
      toast({
        title: "Service entry submitted",
        description: "An admin will review and approve it for points.",
      });
      setLogOpen(false);
      setDraft({
        date: new Date().toISOString().slice(0, 10),
        hours: "1",
        minutes: "0",
        description: "",
        proof_path: "",
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
    const comment = window.prompt(
      `Reject "${entry.description || "this entry"}"? Optional comment for the member:`,
    );
    if (comment === null) return;
    try {
      await reviewEntry.mutateAsync({
        id: entry.id,
        body: { status: "REJECTED", review_comment: comment || undefined },
      });
      toast({
        title: "Entry rejected",
        description: "The member was notified with your comment.",
      });
    } catch (error) {
      toast({
        title: "Couldn't reject entry",
        description: getErrorMessage(
          error,
          "Retry or check your permissions.",
        ),
        variant: "destructive",
      });
    }
  }

  async function withdraw(entry: ServiceEntry) {
    const confirmed = window.confirm(
      "Withdraw this pending service entry? You can always resubmit.",
    );
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
          <h2 className="text-2xl font-semibold tracking-tight">Service hours</h2>
          <p className="text-sm text-muted-foreground">
            Members log hours; admins approve them for service points. Approved
            hours also appear in chapter service reports.
          </p>
        </div>
        <Can permission="service:log">
          <Dialog open={logOpen} onOpenChange={setLogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> Log service
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Log service hours</DialogTitle>
                <DialogDescription>
                  Submit a service entry for admin approval. Proof uploads
                  move to the dashboard in a future slice; paste a link or
                  storage path here for now.
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
                  <Label htmlFor="service-proof">Proof link or storage path (optional)</Label>
                  <Input
                    id="service-proof"
                    value={draft.proof_path}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        proof_path: event.target.value,
                      }))
                    }
                    placeholder="https://... or chapters/{id}/service/{entry}/proof.pdf"
                  />
                </div>
              </form>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setLogOpen(false)}
                  disabled={createEntry.isPending}
                >
                  Cancel
                </Button>
                <Button
                  form="service-log-form"
                  type="submit"
                  disabled={createEntry.isPending}
                >
                  {createEntry.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Submit for approval
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Can>
      </header>

      <Can permission="service:approve">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review queue</CardTitle>
            <CardDescription>
              {pending.length} pending entr{pending.length === 1 ? "y" : "ies"}
              {" "}awaiting approval.
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
                  const name = memberNameById.get(entry.user_id) ?? entry.user_id;
                  return (
                    <li
                      key={entry.id}
                      className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.date} · {formatDuration(entry.duration_minutes)}
                        </p>
                        <p className="mt-1 text-sm">{entry.description}</p>
                        {entry.proof_path ? (
                          <p className="text-xs text-muted-foreground">
                            Proof: {entry.proof_path}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => void approve(entry)}
                          disabled={reviewEntry.isPending}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void reject(entry)}
                          disabled={reviewEntry.isPending}
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
                      <Badge variant={statusBadgeVariant(entry.status)}>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void withdraw(entry)}
                  >
                    Withdraw
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
