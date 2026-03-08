"use client";

import { AlertTriangle } from "lucide-react";
import { useBillingStatus, useInvoices } from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const statusQuery = useBillingStatus();
  const invoicesQuery = useInvoices();
  const isLoading = statusQuery.isLoading || invoicesQuery.isLoading;
  const usingPreviewData = statusQuery.isError || invoicesQuery.isError;

  const billingStatus = (statusQuery.data as BillingStatusPreview | undefined) ?? fallbackStatus;
  const invoices = Array.isArray(invoicesQuery.data)
    ? (invoicesQuery.data as InvoicePreview[])
    : fallbackInvoices;
  const visibleInvoices = usingPreviewData ? fallbackInvoices : invoices;

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
          {visibleInvoices.length === 0 ? (
            <EmptyState
              title="No invoices yet"
              description="Create your first invoice to start chapter dues collection."
              actionLabel="Create invoice"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
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
