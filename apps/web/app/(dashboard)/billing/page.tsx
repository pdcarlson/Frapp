"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useBillingStatus, useInvoices } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/shared/async-states";

type BillingStatusPreview = {
  status: string;
  chapter_id: string;
  stripe_customer_id?: string | null;
  subscription_id?: string | null;
};

type InvoicePreview = {
  id: string;
  title: string;
  amount: number;
  status: string;
  due_date: string;
};

const fallbackStatus: BillingStatusPreview = {
  status: "active",
  chapter_id: "preview-chapter",
  stripe_customer_id: "cus_preview_123",
  subscription_id: "sub_preview_123",
};

const fallbackInvoices: InvoicePreview[] = [
  {
    id: "preview-invoice-1",
    title: "Spring Dues • Jordan M.",
    amount: 15000,
    status: "OPEN",
    due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString(),
  },
  {
    id: "preview-invoice-2",
    title: "Spring Dues • Evan R.",
    amount: 15000,
    status: "PAID",
    due_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
  {
    id: "preview-invoice-3",
    title: "House Fee Adjustment • Dylan P.",
    amount: 7500,
    status: "OVERDUE",
    due_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
  },
];

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
}

export default function BillingPage() {
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "paid" | "overdue">("all");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const statusQuery = useBillingStatus();
  const invoicesQuery = useInvoices();
  const isLoading = statusQuery.isLoading || invoicesQuery.isLoading;
  const usingPreviewData = statusQuery.isError || invoicesQuery.isError;

  const billingStatus = (statusQuery.data as BillingStatusPreview | undefined) ?? fallbackStatus;
  const invoices = Array.isArray(invoicesQuery.data)
    ? (invoicesQuery.data as InvoicePreview[])
    : fallbackInvoices;
  const visibleInvoices = usingPreviewData ? fallbackInvoices : invoices;
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

  if (isLoading) {
    return <LoadingState message="Loading billing overview..." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Subscription Status</CardTitle>
            <CardDescription>Monitor chapter billing health and member invoice progress.</CardDescription>
          </div>
          <Button>Create Invoice</Button>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge className="capitalize">{billingStatus.status}</Badge>
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Customer ID</p>
            <p className="mt-2 text-sm font-medium">{billingStatus.stripe_customer_id ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Subscription ID</p>
            <p className="mt-2 text-sm font-medium">{billingStatus.subscription_id ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {usingPreviewData ? (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Showing preview billing data
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  Sign in to load live chapter subscription and invoice records.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
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
              value={invoiceSearch}
              onChange={(event) => setInvoiceSearch(event.target.value)}
              placeholder="Search invoice or member"
            />
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as "all" | "open" | "paid" | "overdue",
                )
              }
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="all">Status: All</option>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">Open: {openCount}</Badge>
            <Badge variant="secondary">Overdue: {overdueCount}</Badge>
            <Badge variant="secondary">Paid: {paidCount}</Badge>
          </div>
          {selectedInvoiceIds.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary-50/70 p-3 dark:bg-primary/10">
              <p className="text-sm font-medium">
                {selectedInvoiceIds.length} invoice
                {selectedInvoiceIds.length > 1 ? "s" : ""} selected
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline">
                  Send reminder
                </Button>
                <Button size="sm" variant="outline">
                  Export CSV
                </Button>
              </div>
            </div>
          ) : null}
          {filteredInvoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              description="Create your first invoice to start chapter dues collection."
              actionLabel="Create invoice"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible invoices"
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        aria-label={`Select ${invoice.title}`}
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
                    <TableCell className="font-medium">{invoice.title}</TableCell>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
