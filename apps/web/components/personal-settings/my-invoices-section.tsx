"use client";

import { useMemo, useState } from "react";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useCurrentUser, useInvoices } from "@repo/hooks";
import { statusLabel } from "@repo/validation";
import { formatDay } from "@repo/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProfileSection } from "@/components/profile/profile-section";
import { InlineNote } from "@/components/shared/inline-note";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { anyReadUncached } from "@/components/shared/async-states";
import { denseListClassName } from "@/components/shared/table-controls";
import { invoiceStatusKind } from "@/components/billing/invoice-status";
import {
  PayInvoiceDialog,
  type PayableInvoice,
} from "@/components/billing/pay-invoice-dialog";
import { InvoiceRowsSkeleton } from "@/components/billing/billing-skeleton";
import { useNetwork } from "@/lib/providers/network-provider";
import { isStripeConfigured } from "@/lib/stripe";
import { formatCurrency } from "@/lib/currency";

type Invoice = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  amount: number;
  status: "DRAFT" | "OPEN" | "PAID" | "VOID";
  due_date: string;
  created_at?: string;
};

/**
 * Settings → My invoices: the dues this member owes the active chapter, and
 * Pay on each open one (#3827, decision 8 of #4068).
 *
 * It used to be the bottom of `/billing`, which a member reached from an
 * invoice notification although the sidebar row was officer-only. Billing is
 * now an officer row of Chapter settings, so a member's own invoices are here,
 * in the "In <chapter>" group, the way Venmo and a bank app put "your bills"
 * under the account rather than under the merchant's admin screen.
 *
 * Only the caller's rows: the read is filtered to their `user_id`, and a
 * treasurer who opens this sees their own dues, not the chapter's list (that
 * is Plan and billing's). Unpaid first, then by due date, newest first. Drafts
 * are the treasurer's work in progress and never shown here.
 *
 * Hidden while dues is beta-off (`personal-settings-sections.ts`).
 */
export function MyInvoicesSection() {
  const { isOffline } = useNetwork();
  const currentUserQuery = useCurrentUser();
  const userId = (currentUserQuery.data as { id?: string } | undefined)?.id;
  const invoicesQuery = useInvoices(userId, { enabled: Boolean(userId) });
  const [paying, setPaying] = useState<PayableInvoice | null>(null);
  const stripeReady = isStripeConfigured();

  const invoices = useMemo(() => {
    const rows = Array.isArray(invoicesQuery.data)
      ? (invoicesQuery.data as Invoice[])
      : [];
    return rows
      .filter((invoice) => invoice.user_id === userId)
      .filter((invoice) => invoice.status !== "DRAFT")
      .sort((a, b) => {
        const openA = a.status === "OPEN" ? 0 : 1;
        const openB = b.status === "OPEN" ? 0 : 1;
        if (openA !== openB) return openA - openB;
        return a.due_date < b.due_date ? 1 : -1;
      });
  }, [invoicesQuery.data, userId]);

  const owed = invoices
    .filter((invoice) => invoice.status === "OPEN")
    .reduce((sum, invoice) => sum + invoice.amount, 0);

  let body: React.ReactNode;
  if (isOffline && anyReadUncached(currentUserQuery, invoicesQuery)) {
    body = (
      <NestedOffline
        title="Invoices unavailable offline"
        description="Reconnect to see what you owe."
        onRetry={() => {
          void currentUserQuery.refetch();
          void invoicesQuery.refetch();
        }}
      />
    );
  } else if (currentUserQuery.isError || invoicesQuery.isError) {
    body = (
      <NestedError
        title="Couldn't load your invoices"
        description={describeLoadFailure(
          invoicesQuery.error ?? currentUserQuery.error,
        )}
        onRetry={() => {
          void currentUserQuery.refetch();
          void invoicesQuery.refetch();
        }}
      />
    );
  } else if (!userId || invoicesQuery.isPending) {
    body = <InvoiceRowsSkeleton />;
  } else if (invoices.length === 0) {
    body = <InlineNote>Nothing billed to you yet.</InlineNote>;
  } else {
    body = (
      <ul role="list" className={denseListClassName}>
        {invoices.map((invoice) => (
          <li
            key={invoice.id}
            className="flex min-h-11 flex-col gap-2 py-2 @xl:flex-row @xl:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{invoice.title}</p>
              <p className="truncate text-caption text-muted-foreground">
                {[`Due ${formatDay(invoice.due_date)}`, invoice.description]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 @xl:justify-end">
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(invoice.amount)}
              </span>
              <Badge variant={invoiceStatusKind(invoice.status)}>
                {statusLabel("invoice", invoice.status)}
              </Badge>
              {stripeReady && invoice.status === "OPEN" ? (
                <Button
                  size="toolbar"
                  onClick={() =>
                    setPaying({
                      id: invoice.id,
                      title: invoice.title,
                      amount: invoice.amount,
                    })
                  }
                >
                  Pay
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ProfileSection
      id="my-invoices"
      title="My invoices"
      hint={
        owed > 0
          ? `You owe ${formatCurrency(owed)}.`
          : "Dues your chapter bills you, and what you've paid."
      }
    >
      <div className="@container">{body}</div>
      <PayInvoiceDialog
        invoice={paying}
        open={paying !== null}
        onOpenChange={(open) => {
          if (!open) setPaying(null);
        }}
      />
    </ProfileSection>
  );
}
