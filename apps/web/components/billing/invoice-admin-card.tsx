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
import { invoiceStatusKind } from "@/components/billing/invoice-status";
import { stateMicrocopy } from "@/lib/state-microcopy";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
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
import {
  hasNoCachedData,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";

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

export function InvoiceAdminCard() {
  const { toast } = useToast();
  // `POST /v1/invoices` carries no `@FreeTier`, so it is paid-ops and the
  // trigger has to mirror the subscription gate (#858). Reads only — the
  // server guard is still the enforcement.
  const gate = useSubscriptionGate();
  const createDialog = useGatedDialog(gate);
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
  // Two thresholds, because this card makes two different claims.
  //
  // Degrading the badges and the OVERDUE filter is the weak one: it only has to
  // mean "we do not know", which is honest whether the read failed, is paused,
  // or simply has not answered. Without it this card and the page header
  // disagree on one screen — the header reads "Overdue: —" while every badge
  // here silently vanishes and the filter cheerfully returns nothing.
  const overdueUnavailable =
    overdueQuery.isError || hasNoCachedData(overdueQuery);
  // The destructive card is the strong one: it says the read *failed*, in the
  // past tense, in `--destructive`. A query that has not answered yet has not
  // failed, and `GET /invoices/overdue` applies the chapter's grace policy so it
  // is routinely the slowest read on the page — gating the card on the weak
  // flag would flash a red failure notice on ordinary cold loads, which is this
  // family's own confidently-wrong signal with the sign flipped. So: failed, or
  // holding nothing with no request in flight (i.e. paused offline).
  const overdueReadFailed =
    overdueQuery.isError ||
    (hasNoCachedData(overdueQuery) && !overdueQuery.isFetching);
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

  // One mutation object backs every row, so the in-flight guard has to be
  // scoped by id — otherwise a transition on one invoice disables all of them.
  const transitioningId = transitionStatus.isPending
    ? transitionStatus.variables?.id
    : undefined;

  async function submitDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.user_id) {
      toast({
        title: "Pick a member",
        description: "An invoice has to be addressed to someone.",
        variant: "destructive",
      });
      return;
    }
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
      createDialog.setOpen(false);
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
      offlineFallback={(retry) => (
        <PermissionsOfflineSurface
          description="Reconnect to check whether you can manage chapter invoices."
          onRetry={retry}
        />
      )}
    >
      <div className="space-y-6">
        {overdueReadFailed ? (
          <Card className="border-destructive/[.28] bg-destructive/[.13]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive-text">
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
          <Card className="border-destructive/[.28] bg-destructive/[.13]">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-destructive-text">
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
                  <SelectItem value="OVERDUE" disabled={overdueUnavailable}>
                    OVERDUE
                  </SelectItem>
                </SelectContent>
              </Select>
              <Dialog {...createDialog.dialogProps}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2" {...gate.controlProps()}>
                    <Plus className="h-4 w-4" />
                    Create invoice
                  </Button>
                </DialogTrigger>
                <DialogContent
                  className="sm:max-w-lg"
                  {...createDialog.contentProps}
                >
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
                      variant="secondary"
                      onClick={() => createDialog.setOpen(false)}
                      disabled={createInvoice.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      form="invoice-create-form"
                      type="submit"
                      {...gate.controlProps(createInvoice.isPending)}
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
            <SubscriptionNotice
              gate={gate}
              feature="invoicing"
              // Billing supplies its own recovery sentence: §5 rule 3 says never
              // gate a user out of the screen that ungates them, and the default
              // copy would link this screen to itself. The subscription card is
              // directly above.
              recovery={
                gate.state.allowed
                  ? null
                  : gate.state.recoverable
                    ? "Use the subscription card at the top of this page to restore invoicing."
                    : "Reopen the subscription from the billing portal to restore invoicing."
              }
            />
            {invoicesQuery.isPending ? (
              <NestedLoading message={stateMicrocopy.billing.loading} />
            ) : invoicesQuery.isError ? (
              <NestedError
                title="Couldn't load invoices"
                description="Verify your chapter access and API health, then retry."
                onRetry={() => void invoicesQuery.refetch()}
              />
            ) : filtered.length === 0 ? (
              statusFilter === "ALL" ? (
                <NestedEmpty
                  title={stateMicrocopy.billing.emptyTitle}
                  description={stateMicrocopy.billing.emptyDescription}
                />
              ) : (
                <NestedEmpty
                  title="No invoices match this filter"
                  description="Try a different status, or clear the filter to see every invoice."
                />
              )
            ) : (
              <ul className="divide-y divide-border">
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
                        <p className="text-[12.5px] text-muted-foreground">
                          {name} · Due{" "}
                          {new Date(invoice.due_date).toLocaleDateString()}
                        </p>
                        {invoice.description ? (
                          <p className="truncate text-[12.5px] text-muted-foreground">
                            {invoice.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatCurrency(invoice.amount)}
                        </span>
                        <Badge variant={invoiceStatusKind(invoice.status)}>
                          {invoice.status}
                        </Badge>
                        {overdueRow ? (
                          <Badge variant="destructive">OVERDUE</Badge>
                        ) : null}
                        {/*
                          `POST /v1/invoices/:id/status` is paid-ops too, so
                          these mirror the same gate as the create trigger.
                          Gating only Create would leave the card claiming
                          writes are blocked while still offering three of them.
                        */}
                        {invoice.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            {...gate.controlProps(
                              transitioningId === invoice.id,
                            )}
                            onClick={() => void transition(invoice, "OPEN")}
                          >
                            Send (mark OPEN)
                          </Button>
                        ) : null}
                        {invoice.status === "OPEN" ? (
                          <>
                            <Button
                              size="sm"
                              {...gate.controlProps(
                                transitioningId === invoice.id,
                              )}
                              onClick={() => void transition(invoice, "PAID")}
                            >
                              Mark paid
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              {...gate.controlProps(
                                transitioningId === invoice.id,
                              )}
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
          <CardFooter className="text-[12.5px] text-muted-foreground">
            Stripe webhooks handle automatic PAID transitions. Manual Paid /
            Void buttons exist for corrections and cash-paid dues.
          </CardFooter>
        </Card>
      </div>
    </Can>
  );
}
