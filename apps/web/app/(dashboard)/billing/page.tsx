"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  useBillingStatus,
  useCurrentUser,
  useInvoices,
  useOverdueInvoices,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import {
  invoiceStatusKind,
  subscriptionStatusKind,
  subscriptionStatusLabel,
} from "@/components/billing/invoice-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasNoCachedData, LoadingState, OfflineState } from "@/components/shared/async-states";
import { NestedEmpty } from "@/components/shared/nested-states";
import {
  dashboardCheckboxCellClassName,
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { downloadCsv } from "@/lib/utils";
import { InvoiceAdminCard } from "@/components/billing/invoice-admin-card";
import { SubscriptionCheckoutCard } from "@/components/billing/subscription-checkout-card";
import {
  PayInvoiceDialog,
  type PayableInvoice,
} from "@/components/billing/pay-invoice-dialog";
import { useChapterSubscription } from "@/lib/hooks/use-subscription-write-state";
import { isStripeConfigured } from "@/lib/stripe";
import { formatCurrency } from "@/lib/currency";
import { formatLocaleDate as formatDate } from "@repo/formatting";
import { asArray } from "@/lib/utils";

// Mirrors what `BillingService.getChapterBillingStatus` actually returns. The
// Stripe identifiers have no other source; `subscription_status` is kept as a
// display fallback only — see the badge below (#841).
type BillingStatusPreview = {
  subscription_status?: string;
  stripe_customer_id?: string | null;
  subscription_id?: string | null;
};

type InvoicePreview = {
  id: string;
  title: string;
  amount: number;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID";
  due_date: string;
  user_id: string;
};

export default function BillingPage() {
  const { isOffline } = useNetwork();
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "paid" | "overdue">("all");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [payingInvoice, setPayingInvoice] = useState<PayableInvoice | null>(
    null,
  );
  const statusQuery = useBillingStatus();
  const invoicesQuery = useInvoices();
  const overdueQuery = useOverdueInvoices();
  const currentUserQuery = useCurrentUser();
  // One reader for subscription state across the whole client (§5, "read
  // subscription state from one place"). `GET /v1/billing/status` and the
  // chapter payload are two caches over one fact, and they resolve
  // independently — so the badge here could read `active` while the invoice
  // card beneath it was still rendering its locked notice, or the reverse.
  const { status: subscriptionStatus } = useChapterSubscription();
  // `currentUserQuery` belongs in this gate: the Pay affordance is gated on
  // `invoice.user_id === currentUserId`, so rendering the table before the
  // caller's identity resolves would briefly show a member their own OPEN
  // invoice with no way to pay it, then pop the button in.
  const isLoading =
    statusQuery.isLoading ||
    invoicesQuery.isLoading ||
    currentUserQuery.isLoading;
  const usingPreviewData = statusQuery.isError || invoicesQuery.isError;

  const billingStatus = statusQuery.data as BillingStatusPreview | undefined;
  const invoices = Array.isArray(invoicesQuery.data)
    ? (invoicesQuery.data as InvoicePreview[])
    : [];
  const visibleInvoices = invoices;
  // Overdue is server-defined (GET /invoices/overdue applies the chapter's
  // dues grace policy), so the filter and the count derive from that list
  // rather than re-deriving `due_date < now` locally — see the identical
  // reasoning in invoice-admin-card.tsx, whose overdueIds this mirrors.
  const overdue = useMemo(
    () => asArray<InvoicePreview>(overdueQuery.data),
    [overdueQuery.data],
  );
  const overdueIds = useMemo(
    () => new Set(overdue.map((invoice) => invoice.id)),
    [overdue],
  );
  // GET /invoices/overdue requires `billing:view`, which most members do not
  // hold — this page is not admin-only (`canPay` below exists precisely so a
  // member without that permission can pay their own OPEN invoice here), so
  // that 403 is the common case, not an edge case. Without this flag,
  // `overdueIds` degrading to an empty set on error reads as "nothing is
  // overdue" rather than "we don't know" — silently reintroducing the exact
  // confidently-wrong signal #707 exists to fix, for most of the userbase.
  // `isError` alone was never sufficient, and this page rendering offline is
  // only the second way to prove it. The flag has to mean "we do not know",
  // and there are two ways not to know: the read failed, or it has not
  // answered. `overdueQuery` is absent from `isLoading` above, so the second
  // case is reachable *online* too — on every first paint the header asserted
  // "Overdue: 0" for the duration of the request. Offline the read is paused
  // rather than failed, so it is `isPending` and never `isError`, reaching the
  // same wrong signal by the other route. `hasNoCachedData` covers both, and
  // conditioning it on `isOffline` would have fixed only the new one.
  const overdueUnavailable =
    overdueQuery.isError || hasNoCachedData(overdueQuery);
  const filteredInvoices = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    return visibleInvoices.filter((invoice) => {
      const statusLower = invoice.status.toLowerCase();
      if (statusFilter === "overdue") {
        if (!overdueIds.has(invoice.id)) return false;
      } else if (statusFilter !== "all" && statusLower !== statusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        invoice.title.toLowerCase().includes(query) ||
        statusLower.includes(query)
      );
    });
  }, [visibleInvoices, invoiceSearch, statusFilter, overdueIds]);

  // Changing the search or status filter swaps the visible population, so drop
  // the selection — otherwise the bulk bar keeps counting invoices that are no
  // longer shown, and Export CSV silently exports fewer rows than it claims
  // (or an empty file once none of the selection remains visible).
  /* eslint-disable react-hooks/set-state-in-effect -- reset selection when the visible invoice set changes */
  useEffect(() => {
    setSelectedInvoiceIds([]);
  }, [invoiceSearch, statusFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const invoiceIds = filteredInvoices.map((invoice) => invoice.id);
  const allInvoicesSelected =
    invoiceIds.length > 0 &&
    invoiceIds.every((invoiceId) => selectedInvoiceIds.includes(invoiceId));
  const openCount = visibleInvoices.filter((invoice) => invoice.status === "OPEN").length;
  const overdueCount = visibleInvoices.filter((invoice) => overdueIds.has(invoice.id)).length;
  const paidCount = visibleInvoices.filter((invoice) => invoice.status === "PAID").length;

  // A treasurer's table legitimately contains other members' invoices — the
  // list endpoint returns the whole chapter to anyone holding `billing:view`
  // and only the caller's own rows to everyone else. So the pay affordance is
  // gated on ownership, not merely on status; the API's 403 is the real
  // enforcement, this just avoids offering a button that cannot work.
  const currentUserId = (currentUserQuery.data as { id?: string } | undefined)
    ?.id;
  const stripeReady = isStripeConfigured();

  function canPay(invoice: InvoicePreview): boolean {
    return (
      stripeReady &&
      invoice.status === "OPEN" &&
      !!currentUserId &&
      invoice.user_id === currentUserId
    );
  }

  function exportSelectedInvoicesCsv() {
    const rows = filteredInvoices
      .filter((invoice) => selectedInvoiceIds.includes(invoice.id))
      .map((invoice) => ({
        Title: invoice.title,
        Amount: formatCurrency(invoice.amount),
        Status: invoice.status,
        "Due Date": formatDate(invoice.due_date),
        "Member ID": invoice.user_id,
      }));
    downloadCsv(rows, "invoices");
  }

  /*
   * `statusQuery` is deliberately **not** in this gate. `BillingController` is
   * class-level `@RequirePermissions(billing:view)`, which most members do not
   * hold, so its `data` is permanently `undefined` for them — conjoining it
   * would fire this card for exactly the members `canPay` exists to serve.
   * The fields it feeds already degrade honestly to "—".
   *
   * `currentUserQuery` is in it for the reason the `isLoading` comment above
   * gives: Pay is gated on `invoice.user_id === currentUserId`, so without it
   * a member sees their own OPEN invoice with no way to pay it and nothing
   * saying why.
   */
  if (isOffline && hasNoCachedData(invoicesQuery, currentUserQuery)) {
    return (
      <OfflineState
        title="Billing workspace unavailable offline"
        description="Reconnect to sync subscription status and invoice balances."
        onRetry={() => {
          void statusQuery.refetch();
          void invoicesQuery.refetch();
          void currentUserQuery.refetch();
        }}
      />
    );
  }

  if (isLoading) {
    return <LoadingState message={stateMicrocopy.billing.loading} />;
  }

  return (
    <div className="space-y-6">
      {/*
        First on the page on purpose: when a chapter is locked, the control that
        unlocks it is the only thing on this screen that can succeed. Suspense
        because the card reads `?checkout=` via `useSearchParams`.
      */}
      <Suspense fallback={null}>
        <SubscriptionCheckoutCard />
      </Suspense>

      <Card>
        <CardHeader>
          {/*
            No header trigger here on purpose (#336/#1200): a fully working,
            subscription-gated Create Invoice dialog already ships one card
            down in `InvoiceAdminCard`. A second, unwired button beside it read
            as invoicing being unbuilt.
          */}
          <CardTitle>Subscription Status</CardTitle>
          <CardDescription>Monitor chapter billing health and member invoice progress.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-[12.5px] text-muted-foreground">Status</p>
            <div className="mt-2 flex items-center gap-2">
              {/*
                The chapter record is the single source the *gates* read, so it
                wins here too and the badge can never contradict the invoice
                card below it. But it can be unresolved — the persisted
                `activeChapterId` rehydrates asynchronously, and the chapter
                query can fail on its own — while `GET /v1/billing/status` has
                already answered. Falling back to that answer keeps a paying
                chapter from being told "unknown" next to its own live Stripe
                ids, with no error banner (this page's `usingPreviewData` watches
                only the billing and invoice queries) and no way to recover.
                The fallback is display-only: no gate reads it.
              */}
              <Badge
                variant={subscriptionStatusKind(
                  subscriptionStatus ?? billingStatus?.subscription_status,
                )}
              >
                {subscriptionStatusLabel(
                  subscriptionStatus ?? billingStatus?.subscription_status,
                )}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-[12.5px] text-muted-foreground">Customer ID</p>
            <p className="mt-2 font-mono text-sm">{billingStatus?.stripe_customer_id ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-[12.5px] text-muted-foreground">Subscription ID</p>
            <p className="mt-2 font-mono text-sm">{billingStatus?.subscription_id ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {usingPreviewData ? (
        <Card className="border-warning/[.28] bg-warning/[.13]">
          <CardContent className="flex items-center justify-between gap-4 pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-semibold text-warning">
                  {stateMicrocopy.billing.previewTitle}
                </p>
                <p className="text-[12.5px] text-warning">
                  {stateMicrocopy.billing.previewDescription}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                statusQuery.refetch();
                invoicesQuery.refetch();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Member Invoices</CardTitle>
          <CardDescription>Track dues collection and overdue balances.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              aria-label="Search invoices or members"
              value={invoiceSearch}
              onChange={(event) => setInvoiceSearch(event.target.value)}
              placeholder="Search invoice or member"
              className="h-11"
            />
            <select
              aria-label="Invoice status filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as "all" | "open" | "paid" | "overdue",
                )
              }
              className={dashboardFilterSelectClassName}
            >
              <option value="all">Status: All</option>
              <option value="open">Open</option>
              <option
                value="overdue"
                disabled={overdueUnavailable}
                title={
                  overdueUnavailable
                    ? "Overdue status is unavailable right now"
                    : undefined
                }
              >
                Overdue
              </option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
            <Badge variant="secondary" className="tabular-nums">Open: {openCount}</Badge>
            <Badge
              variant="secondary"
              className="tabular-nums"
              title={
                overdueUnavailable
                  ? "Overdue status is unavailable right now"
                  : undefined
              }
            >
              Overdue: {overdueUnavailable ? "—" : overdueCount}
            </Badge>
            <Badge variant="secondary" className="tabular-nums">Paid: {paidCount}</Badge>
          </div>
          {selectedInvoiceIds.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-subtle p-3">
              <p className="text-sm font-semibold">
                {selectedInvoiceIds.length} invoice
                {selectedInvoiceIds.length > 1 ? "s" : ""} selected
              </p>
              {/*
                Send reminder removed rather than wired (#336): overdue
                members already get an automatic notification
                (`InvoiceAdminCard`'s footer), and there is no manual-remind
                endpoint to call — adding one would be a new feature, not a
                wiring fix.
              */}
              <Button size="sm" variant="secondary" onClick={exportSelectedInvoicesCsv}>
                Export CSV
              </Button>
            </div>
          ) : null}
          {filteredInvoices.length === 0 ? (
            <NestedEmpty
              title={stateMicrocopy.billing.emptyTitle}
              description={stateMicrocopy.billing.emptyDescription}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={dashboardCheckboxCellClassName}>
                    <label className={dashboardCheckboxHitAreaClassName}>
                      <input
                        type="checkbox"
                        aria-label="Select all visible invoices"
                        className={dashboardTableCheckboxClassName}
                        checked={allInvoicesSelected}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setSelectedInvoiceIds((previous) => [
                              ...new Set([...previous, ...invoiceIds]),
                            ]);
                            return;
                          }
                          setSelectedInvoiceIds((previous) =>
                            previous.filter((id) => !invoiceIds.includes(id)),
                          );
                        }}
                      />
                    </label>
                  </TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow
                    key={invoice.id}
                    data-state={
                      selectedInvoiceIds.includes(invoice.id) ? "selected" : undefined
                    }
                  >
                    <TableCell className={dashboardCheckboxCellClassName}>
                      <label className={dashboardCheckboxHitAreaClassName}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${invoice.title}`}
                          className={dashboardTableCheckboxClassName}
                          checked={selectedInvoiceIds.includes(invoice.id)}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedInvoiceIds((previous) => [
                                ...new Set([...previous, invoice.id]),
                              ]);
                              return;
                            }
                            setSelectedInvoiceIds((previous) =>
                              previous.filter((id) => id !== invoice.id),
                            );
                          }}
                        />
                      </label>
                    </TableCell>
                    <TableCell className="font-semibold">{invoice.title}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatCurrency(invoice.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={invoiceStatusKind(invoice.status)}>
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(invoice.due_date)}</TableCell>
                    <TableCell className="text-right">
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <InvoiceAdminCard />

      <PayInvoiceDialog
        invoice={payingInvoice}
        open={payingInvoice !== null}
        onOpenChange={(next) => {
          if (!next) setPayingInvoice(null);
        }}
      />
    </div>
  );
}
