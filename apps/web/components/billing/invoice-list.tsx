"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import {
  useCreateInvoice,
  useCurrentUser,
  useInvoices,
  useMembers,
  useMyPermissions,
  useOverdueInvoices,
  useTransitionInvoiceStatus,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { formatBareDate } from "@repo/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EYEBROW } from "@/components/ui/typography";
import { invoiceStatusKind } from "@/components/billing/invoice-status";
import {
  PayInvoiceDialog,
  type PayableInvoice,
} from "@/components/billing/pay-invoice-dialog";
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
import { anyReadUncached } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
} from "@/components/shared/nested-states";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/hooks/use-toast";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { isStripeConfigured } from "@/lib/stripe";
import { formatCurrency } from "@/lib/currency";
import { asArray, cn, downloadCsv, getErrorMessage } from "@/lib/utils";

/**
 * The chapter's invoices, as **one** list.
 *
 * **There were two, and they showed the same rows.** `/billing` rendered a
 * "Member Invoices" card holding a checkbox table with search, a status filter,
 * three count badges, CSV export and a Pay button — and directly beneath it an
 * `InvoiceAdminCard` holding a second list of the same `useInvoices()` data
 * with its own status filter, its own overdue badges and the DRAFT/OPEN/VOID
 * transitions. `GET /v1/invoices` returns the whole chapter to a holder of
 * `billing:view` and only the caller's own rows to everyone else, so both lists
 * always held **identical** rows for the same viewer: a treasurer read their
 * chapter's invoices twice, in two different visual treatments, with different
 * affordances on each copy.
 *
 * Two cards hid that. Flattening them (`1f` pin 2: one toolbar row, no wrapper
 * card, no description paragraph) does not — it would leave two bare,
 * identical lists stacked on one page, which is worse than what shipped. So
 * the flatten forces the merge, and `invoice-admin-card.tsx` is deleted in the
 * same change per the cutover rule.
 *
 * **Nothing is gated differently than it was.** The officer half —
 * create, the three transitions, member names and the overdue summary — is
 * still `billing:manage`, and the member half — see your own invoices, pay an
 * OPEN one — is still open to anyone who can reach the route. What changed is
 * that they are one list instead of two.
 *
 * **`useMembers` is gated on the permission rather than on the component
 * tree**, which is the one thing the merge could have broken quietly.
 * `GET /v1/members` needs `members:view`; it used to fire only because
 * `InvoiceAdminCard` mounted inside `<Can permission="billing:manage">` and a
 * member never reached it. Hoisting the list out of that wrapper would have
 * fired a guaranteed 403 for every member on every visit, so the query is
 * `enabled` on the same `can("billing:manage", …)` the officer column reads —
 * the idiom `chat/renderers/event-card.tsx` already uses for the attendance
 * roster, and for the same reason.
 */

type Invoice = {
  id: string;
  chapter_id?: string;
  user_id: string;
  title: string;
  description?: string | null;
  amount: number;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID";
  due_date: string;
  created_at?: string;
};

type MemberSummary = {
  user_id?: string;
  display_name?: string | null;
};

type StatusFilter = "all" | "draft" | "open" | "overdue" | "paid" | "void";

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Status: All" },
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "void", label: "Void" },
];

export function InvoiceList({ id }: { id?: string }) {
  const { toast } = useToast();

  const { data: permissionsPayload } = useMyPermissions();
  const canManage = can(
    "billing:manage",
    permissionsPayload?.permissions ?? [],
  );

  // `POST /v1/invoices` and `POST /v1/invoices/:id/status` carry no
  // `@FreeTier`, so both are paid-ops and every control that reaches them
  // mirrors the subscription gate (#858). Reads only — the server guard is
  // still the enforcement.
  const gate = useSubscriptionGate();
  const createDialog = useGatedDialog(gate);

  const invoicesQuery = useInvoices();
  const overdueQuery = useOverdueInvoices();
  const currentUserQuery = useCurrentUser();
  const membersQuery = useMembers({ enabled: canManage });
  const createInvoice = useCreateInvoice();
  const transitionStatus = useTransitionInvoiceStatus();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [payingInvoice, setPayingInvoice] = useState<PayableInvoice | null>(
    null,
  );
  const [draft, setDraft] = useState({
    user_id: "",
    title: "",
    description: "",
    amount: "",
    due_date: "",
  });

  const invoices = useMemo(
    () => asArray<Invoice>(invoicesQuery.data),
    [invoicesQuery.data],
  );
  // Overdue is server-defined (`GET /v1/invoices/overdue` applies the chapter's
  // dues grace policy), so the badges, the count and the filter all derive from
  // that list rather than re-deriving `due_date < now` locally — a local check
  // would contradict the server for invoices inside the grace window.
  const overdue = useMemo(
    () => asArray<Invoice>(overdueQuery.data),
    [overdueQuery.data],
  );
  const overdueIds = useMemo(
    () => new Set(overdue.map((invoice) => invoice.id)),
    [overdue],
  );

  /*
   * "We do not know", and there are two ways not to know: the read failed, or
   * it has not answered.
   *
   * `GET /v1/invoices/overdue` requires `billing:view`, which most members do
   * not hold — and this route is deliberately not officer-only, since a member
   * pays their own OPEN invoice here — so that 403 is the common case rather
   * than an edge case. Without this flag an empty `overdueIds` reads as
   * "nothing is overdue" instead, which is the confidently-wrong signal #707
   * exists to fix, for most of the userbase. `isError` alone was never enough:
   * on every first paint the count asserted zero for the duration of the
   * request, and offline the read is *paused* rather than failed, so it is
   * `isPending` and never `isError`. `anyReadUncached` covers both.
   */
  const overdueUnavailable =
    overdueQuery.isError || anyReadUncached(overdueQuery);

  /*
   * The stronger claim, and it needs the stronger threshold. The overdue
   * summary says the read *failed*, in the past tense, in `--destructive`. A
   * query that has not answered yet has not failed, and this is routinely the
   * slowest read on the page, so gating the summary on the weak flag would
   * flash a red failure notice on ordinary cold loads.
   *
   * `fetchStatus === "paused"` and not `!isFetching`, which is broader than it
   * reads: a query TanStack has never started is `"idle"`, and
   * `useOverdueInvoices` is `enabled: !!chapterId`, so `!isFetching` would also
   * cover a read that was never attempted — the same asserted-from-nothing
   * signal this flag exists to suppress, one state over.
   */
  const overdueReadFailed =
    overdueQuery.isError ||
    (overdueQuery.isPending && overdueQuery.fetchStatus === "paused");

  const members = useMemo(
    () => asArray<MemberSummary>(membersQuery.data),
    [membersQuery.data],
  );
  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (member.user_id) {
        map.set(String(member.user_id), member.display_name ?? "Unnamed member");
      }
    }
    return map;
  }, [members]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices
      .filter((invoice) => {
        const statusLower = invoice.status.toLowerCase();
        if (statusFilter === "overdue") {
          if (!overdueIds.has(invoice.id)) return false;
        } else if (statusFilter !== "all" && statusLower !== statusFilter) {
          return false;
        }
        if (!query) return true;
        return (
          invoice.title.toLowerCase().includes(query) ||
          statusLower.includes(query) ||
          (memberNameById.get(invoice.user_id) ?? "")
            .toLowerCase()
            .includes(query)
        );
      })
      .sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
  }, [invoices, search, statusFilter, overdueIds, memberNameById]);

  // Changing the search or the status filter swaps the visible population, so
  // drop the selection — otherwise the bulk bar keeps counting invoices that
  // are no longer shown, and Export CSV silently exports fewer rows than it
  // claims (or an empty file once none of the selection remains visible).
  /* eslint-disable react-hooks/set-state-in-effect -- reset selection when the visible invoice set changes */
  useEffect(() => {
    setSelectedIds([]);
  }, [search, statusFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visibleIds = filtered.map((invoice) => invoice.id);
  const allSelected =
    visibleIds.length > 0 &&
    visibleIds.every((invoiceId) => selectedIds.includes(invoiceId));

  const openCount = invoices.filter((i) => i.status === "OPEN").length;
  const paidCount = invoices.filter((i) => i.status === "PAID").length;
  const overdueCount = invoices.filter((i) => overdueIds.has(i.id)).length;

  // A treasurer's list legitimately contains other members' invoices, so the
  // pay affordance is gated on ownership and not merely on status. The API's
  // 403 is the real enforcement; this just avoids offering a button that
  // cannot work.
  const currentUserId = (currentUserQuery.data as { id?: string } | undefined)
    ?.id;
  const stripeReady = isStripeConfigured();

  function canPay(invoice: Invoice): boolean {
    return (
      stripeReady &&
      invoice.status === "OPEN" &&
      !!currentUserId &&
      invoice.user_id === currentUserId
    );
  }

  // One mutation object backs every row, so the in-flight guard has to be
  // scoped by id — otherwise a transition on one invoice disables all of them.
  const transitioningId = transitionStatus.isPending
    ? transitionStatus.variables?.id
    : undefined;

  function exportSelectedCsv() {
    const rows = filtered
      .filter((invoice) => selectedIds.includes(invoice.id))
      .map((invoice) => ({
        Title: invoice.title,
        Amount: formatCurrency(invoice.amount),
        Status: invoice.status,
        "Due Date": formatBareDate(invoice.due_date),
        "Member ID": invoice.user_id,
      }));
    downloadCsv(rows, "invoices");
  }

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
        description: getErrorMessage(error, "Retry or confirm billing:manage."),
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
    <section
      id={id}
      aria-labelledby="invoice-list-heading"
      className="space-y-3"
    >
      {/*
        One toolbar row: the list's name and its counts on the left, its
        controls on the right, on the page surface. `1f` pin 2.

        The three `Open: n` / `Overdue: n` / `Paid: n` badges this replaces were
        the last `Badge` row on the page, and §8 deleted that shape one family
        over. Every number survives, in the count line the alumni list already
        uses for "42 alumni" — which reads as metadata rather than as three
        statuses about nothing in particular.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2
            id="invoice-list-heading"
            className={`${EYEBROW} truncate text-muted-foreground`}
          >
            Invoices
          </h2>
          {/*
            Only once the read has answered. `openCount` and `paidCount` come
            from `invoices`, which is `[]` while `GET /v1/invoices` is in
            flight — so rendering this unconditionally put "0 open · 0 paid"
            above the spinner for the length of the round trip, which is the
            confidently-wrong signal #707 exists to stop, on two more numbers.
            The page this replaces could not reach that state because it gated
            its whole body on a page-level `isLoading`; this list has no such
            gate, so the guard moves here. Same shape the alumni list uses for
            its own count.
          */}
          {invoicesQuery.isSuccess ? (
          <p className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
            {openCount} open ·{" "}
            <span
              title={
                overdueUnavailable
                  ? "Overdue status is unavailable right now"
                  : undefined
              }
            >
              {overdueUnavailable ? "overdue unknown" : `${overdueCount} overdue`}
            </span>{" "}
            · {paidCount} paid
          </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Search invoices or members"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search invoice or member"
            className="h-11 w-full sm:w-56"
          />
          <select
            aria-label="Invoice status filter"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
            className={dashboardFilterSelectClassName}
          >
            {STATUS_FILTERS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value === "overdue" && overdueUnavailable}
                title={
                  option.value === "overdue" && overdueUnavailable
                    ? "Overdue status is unavailable right now"
                    : undefined
                }
              >
                {option.label}
              </option>
            ))}
          </select>
          {/*
            The create trigger is the **only** officer control that stays a
            `<Can>` rather than reading the `canManage` boolean, and it is
            deliberate: `<Can>`'s default `offlineFallback` is §10's
            control-slot `PermissionsOffline`, so an officer whose permission
            read is paused with nothing cached gets "Offline, can't check your
            access" in this slot instead of a list that has quietly lost four
            buttons. `canManage` is false in that window — it has to be, since
            the gate fails closed — so without this one explanatory slot the
            whole officer half would disappear with nothing saying why, which
            is #1211's failure exactly. One line covers all of them because
            they are one surface.
          */}
          <Can permission="billing:manage">
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
                  {/*
                    Kept, unlike the upload sheets' descriptions that §8
                    deleted. `1j`'s "no instructional paragraph" is about that
                    sheet; this dialog is the case §8 itself carved out for the
                    folder dialog — it has a genuine description, because the
                    thing it creates is invisible to the member until a second,
                    separate action.
                  */}
                  <DialogDescription>
                    Drafts stay hidden from members until you transition them to
                    OPEN.
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
                        <SelectValue placeholder="Pick one" />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((member) => (
                          <SelectItem
                            key={member.user_id ?? "unknown"}
                            value={String(member.user_id ?? "")}
                          >
                            {member.display_name ?? "Unnamed member"}
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
          </Can>
        </div>
      </div>

      {/*
        Disable, don't hide (§5 rule 4): a lapsed subscription is recoverable,
        and hiding invoicing entirely would read as a missing feature rather
        than an explainable state. Billing supplies its own recovery sentence
        because §5 rule 3 says never gate a user out of the screen that ungates
        them, and the default copy would link this screen to itself.
      */}
      {canManage ? (
        <SubscriptionNotice
          gate={gate}
          feature="invoicing"
          className="mb-0"
          /*
            Both branches point at the plan panel, and the `canceled` one is a
            fix rather than a paste. The shared `DefaultRecovery` sends a
            non-recoverable chapter to "the billing portal", and #929
            established that the Portal cannot resume a terminated
            subscription — it only reactivates one still scheduled to cancel at
            period end, which our status map reports as `active`. So that
            sentence named a dead end, and the panel above, whose canceled
            action is a fresh checkout, is the real way back. The shared
            default still says it on the surfaces this lane does not own.
          */
          recovery={
            gate.state.allowed
              ? null
              : gate.state.recoverable
                ? "Use the plan panel at the top of this page to restore invoicing."
                : "Use the plan panel at the top of this page to restart the subscription."
          }
        />
      ) : null}

      {canManage ? (
        <OverdueSummary
          failed={overdueReadFailed}
          count={overdue.length}
        />
      ) : null}

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-subtle p-3">
          <p className="text-sm font-semibold">
            {selectedIds.length} invoice{selectedIds.length > 1 ? "s" : ""}{" "}
            selected
          </p>
          {/*
            Send reminder was removed rather than wired (#336): overdue members
            already get an automatic notification, and there is no
            manual-remind endpoint to call.
          */}
          <Button size="sm" variant="secondary" onClick={exportSelectedCsv}>
            Export CSV
          </Button>
        </div>
      ) : null}

      {/*
        `currentUserQuery` belongs in this gate, and the page this replaces
        said why at its own: the Pay affordance is gated on
        `invoice.user_id === currentUserId`, so rendering rows before the
        caller's identity resolves briefly shows a member their own OPEN
        invoice with no way to pay it, then pops the button in. That gate was
        page-level and went with the page body, so it moves here, where the
        rows it is about actually render.
      */}
      {invoicesQuery.isPending || currentUserQuery.isPending ? (
        <NestedLoading sole message={stateMicrocopy.billing.loading} />
      ) : invoicesQuery.isError ? (
        <NestedError
          sole
          title="Couldn't load invoices"
          description="Verify your chapter access and API health, then retry."
          onRetry={() => void invoicesQuery.refetch()}
        />
      ) : filtered.length === 0 ? (
        statusFilter === "all" && !search.trim() ? (
          <NestedEmpty
            sole
            title={stateMicrocopy.billing.emptyTitle}
            description={stateMicrocopy.billing.emptyDescription}
          />
        ) : (
          <NestedEmpty
            sole
            title="No invoices match this filter"
            description="Try a different status, or clear the filter to see every invoice."
          />
        )
      ) : (
        <>
          {/*
            The hit area is on the inner `<span>` and the label wraps it plus
            the text, which is `/members`' shape — putting the 24/44 box on the
            label itself would clip the words out of the clickable region.
          */}
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className={dashboardCheckboxHitAreaClassName}>
              {/*
                No `aria-label`. The wrapping `<label>` already names this from
                its visible text, and an `aria-label` overrides that — leaving
                the accessible name ("Select all visible invoices") without the
                words on screen ("Select all shown"), which is WCAG 2.5.3 and
                breaks voice control: "click Select all shown" matches nothing.
                The header cell this replaces needed the attribute because it
                had no visible text; the flatten gave it words and should have
                dropped the attribute with the same change.
              */}
              <input
                type="checkbox"
                className={dashboardTableCheckboxClassName}
                checked={allSelected}
                onChange={(event) => {
                  if (event.target.checked) {
                    setSelectedIds((previous) => [
                      ...new Set([...previous, ...visibleIds]),
                    ]);
                    return;
                  }
                  setSelectedIds((previous) =>
                    previous.filter((value) => !visibleIds.includes(value)),
                  );
                }}
              />
            </span>
            Select all shown
          </label>
          <ul role="list" className={denseListClassName}>
            {filtered.map((invoice) => {
              const selected = selectedIds.includes(invoice.id);
              const isOverdue = overdueIds.has(invoice.id);
              const memberName = canManage
                ? (memberNameById.get(invoice.user_id) ?? invoice.user_id)
                : null;
              return (
                <li
                  key={invoice.id}
                  className={cn(
                    // Two lines and the row is not itself a control, so this is
                    // lane 4's flat `min-h-11` document row rather than
                    // `/members`' 36/44 — see `deletion-checklist.md` §9's table
                    // of the two geometries.
                    "flex min-h-11 flex-col gap-2 py-2 md:flex-row md:items-center",
                    selected && "bg-accent-subtle-hover text-accent-text",
                  )}
                >
                  <label
                    className={`${dashboardCheckboxHitAreaClassName} shrink-0`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${invoice.title}`}
                      className={dashboardTableCheckboxClassName}
                      checked={selected}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedIds((previous) => [
                            ...new Set([...previous, invoice.id]),
                          ]);
                          return;
                        }
                        setSelectedIds((previous) =>
                          previous.filter((value) => value !== invoice.id),
                        );
                      }}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {invoice.title}
                    </p>
                    {/*
                      One meta line, not three. §8 deleted "the third text line
                      per row" one family over and folded what it carried
                      inline; the description joins the member and the due date
                      here for the same reason.
                    */}
                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {[
                        memberName,
                        `Due ${formatBareDate(invoice.due_date)}`,
                        invoice.description || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(invoice.amount)}
                    </span>
                    <Badge variant={invoiceStatusKind(invoice.status)}>
                      {invoice.status}
                    </Badge>
                    {isOverdue ? (
                      <Badge variant="destructive">OVERDUE</Badge>
                    ) : null}
                    {canPay(invoice) ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          setPayingInvoice({
                            id: invoice.id,
                            title: invoice.title,
                            amount: invoice.amount,
                          })
                        }
                      >
                        Pay
                      </Button>
                    ) : null}
                    {/*
                      `POST /v1/invoices/:id/status` is paid-ops too, so these
                      mirror the same gate as the create trigger. Gating only
                      Create would leave the surface claiming writes are blocked
                      while still offering three of them.
                    */}
                    {canManage && invoice.status === "DRAFT" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        {...gate.controlProps(transitioningId === invoice.id)}
                        onClick={() => void transition(invoice, "OPEN")}
                      >
                        Send (mark OPEN)
                      </Button>
                    ) : null}
                    {canManage && invoice.status === "OPEN" ? (
                      <>
                        <Button
                          size="sm"
                          {...gate.controlProps(transitioningId === invoice.id)}
                          onClick={() => void transition(invoice, "PAID")}
                        >
                          Mark paid
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          {...gate.controlProps(transitioningId === invoice.id)}
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
        </>
      )}

      <PayInvoiceDialog
        invoice={payingInvoice}
        open={payingInvoice !== null}
        onOpenChange={(next) => {
          if (!next) setPayingInvoice(null);
        }}
      />
    </section>
  );
}

/**
 * The overdue signal, as a line rather than the two destructive cards it was.
 *
 * Both cards said one thing each — the read failed, or N invoices are past due
 * — inside a `CardHeader` with a `CardTitle` and a `CardDescription`. The board
 * gives this page one banner and puts it at the top (`4d` note 4, carried by
 * `billing-page.tsx`); this is the list's own, so it is a line on the page
 * surface with the hairline that `components.md` §2 makes the load-bearing
 * edge.
 */
function OverdueSummary({
  failed,
  count,
}: {
  failed: boolean;
  count: number;
}) {
  if (!failed && count === 0) return null;

  /*
    Not a live region, for the reason `billing-page.tsx`'s lapse banner gives:
    this is durable content that is present whenever the chapter has overdue
    invoices, not an announcement of something that just happened. Four polite
    regions on one page load is a wall of speech, and the two that are really
    about a transition — the loading state and `SubscriptionNotice`'s revoke —
    are the ones worth keeping.
  */
  return (
    <p className="flex items-center gap-2 rounded-md border border-destructive/45 bg-destructive/[.13] px-3 py-2 text-[12.5px] text-destructive-text">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {failed
        ? "Couldn't load the overdue list. Overdue badges and the Overdue filter are unavailable until it recovers."
        : `${count} invoice${count === 1 ? "" : "s"} past due. Members receive an overdue notification automatically.`}
    </p>
  );
}
