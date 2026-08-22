"use client";

import { Suspense, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useBillingStatus, useCurrentUser, useInvoices } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState, OfflineState } from "@/components/shared/async-states";
import {
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/hooks/use-toast";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
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
  status: string;
  due_date: string;
  user_id: string;
};

export default function BillingPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "paid" | "overdue">("all");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [payingInvoice, setPayingInvoice] = useState<PayableInvoice | null>(
    null,
  );
  const statusQuery = useBillingStatus();
  const invoicesQuery = useInvoices();
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
  const filteredInvoices = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    return visibleInvoices.filter((invoice) => {
      const statusLower = invoice.status.toLowerCase();
      if (statusFilter !== "all" && statusLower !== statusFilter) {
        return false;
      }
      if (!query) return true;
      return (
        invoice.title.toLowerCase().includes(query) ||
        statusLower.includes(query)
      );
    });
  }, [visibleInvoices, invoiceSearch, statusFilter]);
  const invoiceIds = filteredInvoices.map((invoice) => invoice.id);
  const allInvoicesSelected =
    invoiceIds.length > 0 &&
    invoiceIds.every((invoiceId) => selectedInvoiceIds.includes(invoiceId));
  const openCount = visibleInvoices.filter((invoice) => invoice.status === "OPEN").length;
  const overdueCount = visibleInvoices.filter((invoice) => invoice.status === "OVERDUE").length;
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

  function handleInvoiceAction(actionLabel: string) {
    toast({
      title: "Billing action queued",
      description: `${actionLabel} is not available yet. Please continue using current billing workflows.`,
    });
  }

  function handleBulkInvoiceAction(actionLabel: string) {
    toast({
      title: "Bulk billing action queued",
      description: `${actionLabel} for ${selectedInvoiceIds.length} selected invoice${selectedInvoiceIds.length > 1 ? "s" : ""} is not available yet.`,
    });
  }

  if (isOffline) {
    return (
      <OfflineState
        title="Billing workspace unavailable offline"
        description="Reconnect to sync subscription status and invoice balances."
        onRetry={() => {
          void statusQuery.refetch();
          void invoicesQuery.refetch();
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
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Subscription Status</CardTitle>
            <CardDescription>Monitor chapter billing health and member invoice progress.</CardDescription>
          </div>
          <Button onClick={() => handleInvoiceAction("Create Invoice")}>
            Create Invoice
          </Button>
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
              <Badge className="capitalize">
                {subscriptionStatus ??
                  billingStatus?.subscription_status ??
                  "unknown"}
              </Badge>
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-[12.5px] text-muted-foreground">Customer ID</p>
            <p className="mt-2 text-sm font-semibold">{billingStatus?.stripe_customer_id ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-[12.5px] text-muted-foreground">Subscription ID</p>
            <p className="mt-2 text-sm font-semibold">{billingStatus?.subscription_id ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {usingPreviewData ? (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Billing depends on live chapter activation
                </p>
                <p className="text-[12.5px] text-amber-800 dark:text-amber-200">
                  Complete chapter bootstrap and billing activation before expecting live invoice data.
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
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
            <Badge variant="secondary">Open: {openCount}</Badge>
            <Badge variant="secondary">Overdue: {overdueCount}</Badge>
            <Badge variant="secondary">Paid: {paidCount}</Badge>
          </div>
          {selectedInvoiceIds.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent-border bg-accent-subtle p-3">
              <p className="text-sm font-semibold">
                {selectedInvoiceIds.length} invoice
                {selectedInvoiceIds.length > 1 ? "s" : ""} selected
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleBulkInvoiceAction("Send reminder")}
                >
                  Send reminder
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleBulkInvoiceAction("Export CSV")}
                >
                  Export CSV
                </Button>
              </div>
            </div>
          ) : null}
          {filteredInvoices.length === 0 ? (
            <EmptyState
              title={stateMicrocopy.billing.emptyTitle}
              description={stateMicrocopy.billing.emptyDescription}
              actionLabel="Create invoice"
              onAction={() => handleInvoiceAction("Create Invoice")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
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
                  <TableRow key={invoice.id}>
                    <TableCell className="w-10">
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
                    </TableCell>
                    <TableCell className="font-semibold">{invoice.title}</TableCell>
                    <TableCell>{formatCurrency(invoice.amount)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={invoice.status === "PAID" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {invoice.status.toLowerCase()}
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
