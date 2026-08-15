"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import {
  useCreateInvoice,
  useInvoices,
  useMembers,
  useOverdueInvoices,
  useTransitionInvoiceStatus,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { useSubscriptionWriteState } from "@/lib/hooks/use-subscription-write-state";

type Invoice = {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  description: string | null;
  amount: number;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID";
  due_date: string;
  paid_at: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
};

type MemberSummary = {
  user_id?: string;
  display_name?: string | null;
};

type StatusFilter = "ALL" | "DRAFT" | "OPEN" | "PAID" | "VOID" | "OVERDUE";

/** Ties the disabled Create-invoice trigger to the sentence explaining it. */
const SUBSCRIPTION_NOTICE_ID = "invoice-create-subscription-notice";

function statusVariant(
  status: Invoice["status"],
): "default" | "outline" | "secondary" | "destructive" {
  switch (status) {
    case "PAID":
      return "default";
    case "OPEN":
      return "secondary";
    case "DRAFT":
      return "outline";
    case "VOID":
      return "destructive";
  }
}

export function InvoiceAdminCard() {
  const { toast } = useToast();
  // `POST /v1/invoices` carries no `@FreeTier`, so it is paid-ops and the
  // trigger has to mirror the subscription gate (#858). Reads only — the
  // server guard is still the enforcement.
  const { state: subscription, isPending: subscriptionPending } =
    useSubscriptionWriteState();
  const canCreateInvoice = subscription.allowed && !subscriptionPending;
  const invoicesQuery = useInvoices();
  const overdueQuery = useOverdueInvoices();
  const membersQuery = useMembers();
  const createInvoice = useCreateInvoice();
  const transitionStatus = useTransitionInvoiceStatus();

  const invoices = useMemo(
    () => asArray<Invoice>(invoicesQuery.data),
    [invoicesQuery.data],
  );
  const overdue = useMemo(
    () => asArray<Invoice>(overdueQuery.data),
    [overdueQuery.data],
  );
  // Overdue is server-defined (GET /invoices/overdue applies the chapter's
  // dues grace policy), so badges and the OVERDUE filter derive from that
  // list rather than re-deriving `due_date < now` locally — a local check
  // would contradict the banner for invoices inside the grace window.
  const overdueIds = useMemo(
    () => new Set(overdue.map((inv) => inv.id)),
    [overdue],
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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({
    user_id: "",
    title: "",
    description: "",
    amount: "",
    due_date: "",
  });

  const filtered = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (statusFilter === "ALL") return true;
        if (statusFilter === "OVERDUE") return overdueIds.has(inv.id);
        return inv.status === statusFilter;
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [invoices, statusFilter, overdueIds]);

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dollars = Number(draft.amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      toast({
        title: "Enter a valid amount",
        description: "Amount must be greater than zero.",
        variant: "destructive",
      });
      return;
    }
    try {
      await createInvoice.mutateAsync({
        user_id: draft.user_id,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        amount: Math.round(dollars * 100),
        due_date: draft.due_date,
      });
      toast({
        title: "Invoice drafted",
        description:
          "Set the status to OPEN to notify the member and start tracking.",
      });
      setCreateOpen(false);
      setDraft({
        user_id: "",
        title: "",
        description: "",
        amount: "",
        due_date: "",
      });
    } catch (error) {
      toast({
        title: "Couldn't create invoice",
        description: getErrorMessage(
          error,
          "Retry or confirm billing:manage.",
        ),
        variant: "destructive",
      });
    }
  }

  async function transition(invoice: Invoice, next: "OPEN" | "PAID" | "VOID") {
    try {
      await transitionStatus.mutateAsync({
        id: invoice.id,
        body: { status: next },
      });
      toast({
        title: "Invoice updated",
        description: `${invoice.title} → ${next}.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't update invoice",
        description: getErrorMessage(
          error,
          "The status transition was rejected by the API.",
        ),
        variant: "destructive",
      });
    }
  }

  return (
    <Can
      permission="billing:manage"
      deniedFallback={null}
    >
      <div className="space-y-6">
        {overdueQuery.isError ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                Overdue status unavailable
              </CardTitle>
              <CardDescription>
                Couldn&apos;t load the overdue list — overdue badges and the
                OVERDUE filter are unavailable until it recovers.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : overdue.length > 0 ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  Overdue invoices
                </CardTitle>
                <CardDescription>
                  {overdue.length} invoice{overdue.length === 1 ? "" : "s"} past
                  due. Members receive an overdue notification automatically.
                </CardDescription>
              </div>
              <Badge variant="destructive">{overdue.length}</Badge>
            </CardHeader>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg">Member invoices</CardTitle>
              <CardDescription>
                Track chapter dues across every member. Stripe webhooks move
                invoices to PAID automatically.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as StatusFilter)
                }
              >
                <SelectTrigger
                  className="w-[160px]"
                  aria-label="Filter invoices"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="DRAFT">DRAFT</SelectItem>
                  <SelectItem value="OPEN">OPEN</SelectItem>
                  <SelectItem value="PAID">PAID</SelectItem>
                  <SelectItem value="VOID">VOID</SelectItem>
                  <SelectItem value="OVERDUE">OVERDUE</SelectItem>
                </SelectContent>
              </Select>
              <Dialog
                open={createOpen}
                onOpenChange={(next) => {
                  // Gate the trigger, never the submit (§5 rule 1): a dialog
                  // must never open onto an action that cannot succeed. The
                  // disabled button covers the pointer path; this covers
                  // programmatic opens and a state flip while it is open.
                  if (next && !canCreateInvoice) return;
                  setCreateOpen(next);
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={!canCreateInvoice}
                    aria-describedby={
                      subscription.allowed
                        ? undefined
                        : SUBSCRIPTION_NOTICE_ID
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Create invoice
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create member invoice</DialogTitle>
                    <DialogDescription>
                      Drafts stay hidden from members until you transition them
                      to OPEN.
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    id="invoice-create-form"
                    className="space-y-4"
                    onSubmit={submitDraft}
                  >
                    <div className="grid gap-1">
                      <Label htmlFor="invoice-member">Member</Label>
                      <Select
                        value={draft.user_id}
                        onValueChange={(value) =>
                          setDraft((prev) => ({ ...prev, user_id: value }))
                        }
                      >
                        <SelectTrigger id="invoice-member">
                          <SelectValue placeholder="Select a member" />
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m) => (
                            <SelectItem
                              key={m.user_id ?? "unknown"}
                              value={String(m.user_id ?? "")}
                            >
                              {m.display_name ?? "Unnamed member"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="invoice-title">Title</Label>
                      <Input
                        id="invoice-title"
                        value={draft.title}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            title: event.target.value,
                          }))
                        }
                        placeholder="Fall 2026 dues"
                        required
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="invoice-description">Description</Label>
                      <Textarea
                        id="invoice-description"
                        rows={2}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            description: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor="invoice-amount">Amount (USD)</Label>
                        <Input
                          id="invoice-amount"
                          type="number"
                          min={0}
                          step={0.01}
                          value={draft.amount}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              amount: event.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor="invoice-due">Due date</Label>
                        <Input
                          id="invoice-due"
                          type="date"
                          value={draft.due_date}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              due_date: event.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                    </div>
                  </form>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setCreateOpen(false)}
                      disabled={createInvoice.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      form="invoice-create-form"
                      type="submit"
                      disabled={createInvoice.isPending}
                    >
                      {createInvoice.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Create draft
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {/*
              Disable, don't hide (§5 rule 4): a lapsed subscription is
              recoverable, and hiding invoicing entirely would read as a
              missing feature rather than an explainable state.
            */}
            {!subscription.allowed ? (
              <p
                id={SUBSCRIPTION_NOTICE_ID}
                className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
              >
                {subscription.reason}{" "}
                {subscription.recoverable
                  ? "Complete checkout at the top of this page to unlock invoicing."
                  : "Contact support from the billing portal to reopen this chapter."}
              </p>
            ) : null}
            {invoicesQuery.isPending ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading invoices...
              </div>
            ) : invoicesQuery.isError ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t load invoices. Retry in a moment.
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {statusFilter === "ALL"
                  ? "No invoices yet. Use Create invoice to send your first dues request."
                  : "No invoices match this filter."}
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {filtered.map((invoice) => {
                  const overdueRow = overdueIds.has(invoice.id);
                  const name =
                    memberNameById.get(invoice.user_id) ?? invoice.user_id;
                  return (
                    <li
                      key={invoice.id}
                      className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {invoice.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {name} · Due{" "}
                          {new Date(invoice.due_date).toLocaleDateString()}
                        </p>
                        {invoice.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {invoice.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">
                          {formatCurrency(invoice.amount)}
                        </span>
                        <Badge variant={statusVariant(invoice.status)}>
                          {invoice.status}
                        </Badge>
                        {overdueRow ? (
                          <Badge variant="destructive">OVERDUE</Badge>
                        ) : null}
                        {invoice.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void transition(invoice, "OPEN")}
                          >
                            Send (mark OPEN)
                          </Button>
                        ) : null}
                        {invoice.status === "OPEN" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void transition(invoice, "PAID")}
                            >
                              Mark paid
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void transition(invoice, "VOID")}
                            >
                              Void
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            Stripe webhooks handle automatic PAID transitions. Manual Paid /
            Void buttons exist for corrections and cash-paid dues.
          </CardFooter>
        </Card>
      </div>
    </Can>
  );
}
