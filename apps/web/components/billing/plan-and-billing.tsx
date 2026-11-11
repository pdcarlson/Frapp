"use client";

import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { useBillingStatus, useCurrentUser, useInvoices } from "@repo/hooks";
import { isBetaOffModule } from "@repo/validation";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedOffline } from "@/components/shared/nested-states";
import { PlanPanel } from "@/components/billing/plan-panel";
import { PlanMatrix } from "@/components/billing/plan-matrix";
import { InvoiceList } from "@/components/billing/invoice-list";
import { subscriptionStatusKind } from "@/components/billing/invoice-status";
import { useChapterSubscription } from "@/lib/hooks/use-subscription-write-state";
import { useNetwork } from "@/lib/providers/network-provider";
import { PlanPanelSkeleton } from "@/components/billing/billing-skeleton";
import { ProfileSection } from "@/components/profile/profile-section";
import { Skeleton } from "@/components/shared/async-states";

const INVOICES_ANCHOR = "invoices";

/**
 * Plan and billing, a row of Chapter settings (#3827, decision 8 of #4068).
 *
 * It was the `/billing` route behind the sidebar's Billing row. The row is
 * gone and `/billing` redirects here for `billing:view` holders; a member's
 * own invoices are My invoices in personal Settings. The body is the one the
 * route had (#2146's `4d`), in the order a president reads it once a
 * semester: is the chapter in good standing, what does the plan include, who
 * owes dues (while dues is on), and how to cancel or close.
 *
 * **What was deleted, and stays deleted.** The route once rendered five
 * `<Card>`s: a checkout card, a "Subscription Status" card wrapping three
 * bordered boxes, a preview-data warning card, a "Member Invoices" card and
 * `InvoiceAdminCard` holding a second list of the same invoices. They became
 * one `PlanPanel`, the matrix and one `InvoiceList`, with none of their
 * narration paragraphs.
 *
 * **Danger zone folded in.** It held a second Stripe portal button and the
 * deactivation note. The portal is the plan panel's own "Manage in Stripe";
 * the note is the last section here, written for whichever kind of plan the
 * chapter is on (a chapter Frapp switched on by hand has no Stripe customer,
 * so "contact support from the billing portal" was advice it could not take).
 *
 * The section sits inside the settings tab panel, which supplies the page's
 * `<h1>` through the top bar; every block here is an `<h2>` section.
 */
export function PlanAndBilling() {
  const { isOffline } = useNetwork();
  /*
   * The invoice list leaves only while dues is beta-off. A chapter's own dues
   * switch doesn't hide it: a member must still be able to pay an invoice
   * the chapter already sent (`spec/product/modules.md` § Module disabling
   * behavior).
   */
  const duesOn = !isBetaOffModule("dues");
  const invoicesQuery = useInvoices(undefined, { enabled: duesOn });
  const currentUserQuery = useCurrentUser();
  const { status } = useChapterSubscription();

  /*
   * `useBillingStatus` is deliberately **not** in this gate, and neither is the
   * chapter subscription read. `BillingController` is class-level
   * `@RequirePermissions(billing:view)`, which most members do not hold, so its
   * data is permanently `undefined` for them — conjoining it would fire the
   * offline screen for exactly the members who came here to pay an invoice.
   * The fields it feeds already degrade honestly by disappearing.
   *
   * `currentUserQuery` is in it: Pay is gated on
   * `invoice.user_id === currentUserId`, so without it a member sees their own
   * OPEN invoice with no way to pay it and nothing saying why.
   */
  const offlineUncached = duesOn
    ? anyReadUncached(invoicesQuery, currentUserQuery)
    : anyReadUncached(currentUserQuery);
  if (isOffline && offlineUncached) {
    return (
      <div className="@container space-y-6">
        {/*
          The **nested** offline state, not the whole-screen one, and on a page
          with no cards left that is the point rather than a technicality.
          `OfflineState` and its siblings paint `--card`; this lane just deleted
          the five `<Card>`s on this route, so rendering one here would put a
          card back through the door the lane closed. The Directory lane made
          the same swap on `/members` and lane 4 on `/documents`
          (`spec/ui/web-dashboard/README.md` § Page grammar). `sole` because while
          this is up it is the page's only async state, so it needs the live
          region and the heading the nested variant leaves off by default.

          The one exception both lanes kept — a whole-screen variant for a
          branch that genuinely replaces a *page* rather than a list — is the
          no-chapter state, and this is not that: the top bar's title is still
          above it and the route is still the route.
        */}
        <NestedOffline
          sole
          title="Billing unavailable offline"
          description={
            duesOn
              ? "Reconnect to sync subscription status and invoice balances."
              : "Reconnect to sync subscription status."
          }
          onRetry={() => {
            if (duesOn) void invoicesQuery.refetch();
            void currentUserQuery.refetch();
          }}
        />
      </div>
    );
  }

  const onPaidPlan = status === "active" || status === "past_due";

  return (
    // A container (#4033): the plan panel and invoice rows count the panel's
    // own width, which the settings rail shares.
    <div className="@container space-y-10">
      {/*
        No `PageActions` row: Create invoice is gated on both
        `billing:manage` and the subscription, and lives in the invoice list's
        own toolbar beside the filter it shares state with.
      */}
      <div className="space-y-4">
        <PastDueBanner status={status} />

        {/*
          `PlanPanel` reads `?checkout=` via `useSearchParams`, which Next
          requires under a Suspense boundary. The fallback is the panel's own
          skeleton, so reading the param does not swap a placeholder for the
          panel.
        */}
        <Suspense fallback={<PlanPanelSkeleton />}>
          <PlanPanel
            invoicesHref={duesOn ? `#${INVOICES_ANCHOR}` : undefined}
          />
        </Suspense>
      </div>

      <PlanMatrix onPaidPlan={onPaidPlan} />

      {duesOn ? <InvoiceList id={INVOICES_ANCHOR} /> : null}

      <CancelOrClose status={status} />
    </div>
  );
}

/** Where a chapter writes to change a plan Frapp set, or to close for good. */
const FRAPP_TEAM_EMAIL = "team@frapp.live";

/**
 * The last section, and what Danger zone used to hold: how to stop paying,
 * and how to close the chapter. It is prose with one link, not a red row of
 * buttons, because neither is a button in this product: cancelling happens in
 * Stripe's portal (the plan panel's "Manage in Stripe"), and closing a
 * chapter is done by Frapp on request.
 *
 * The first sentence depends on the plan, read from the billing record:
 *
 * - **A Stripe customer**: cancel from Manage in Stripe above.
 * - **No customer on an active chapter** (Frapp switched it on by hand): there
 *   is nothing in Stripe to cancel, so changes come to us.
 * - **No subscription** (`incomplete`, `canceled`): nothing to cancel.
 *
 * Until the billing read answers, the line waits on a one-line skeleton
 * rather than guessing; a viewer the read refuses (it is `billing:view`, the
 * same as this row) never gets here.
 */
function CancelOrClose({ status }: { status: string | null }) {
  const statusQuery = useBillingStatus();
  const customerId = (
    statusQuery.data as { stripe_customer_id?: string | null } | undefined
  )?.stripe_customer_id;

  const email = (
    <a
      href={`mailto:${FRAPP_TEAM_EMAIL}`}
      className="font-semibold text-foreground underline underline-offset-4"
    >
      {FRAPP_TEAM_EMAIL}
    </a>
  );

  let cancelLine: React.ReactNode = null;
  const cancelLoading =
    status !== "incomplete" &&
    status !== "canceled" &&
    statusQuery.isPending &&
    statusQuery.fetchStatus !== "paused";
  if (status === "incomplete" || status === "canceled") {
    cancelLine = "There is no subscription to cancel.";
  } else if (cancelLoading) {
    cancelLine = null;
  } else if (customerId) {
    cancelLine = (
      <>
        To cancel, open{" "}
        <span className="text-foreground">
          {/* The plan panel's button for this status: past due offers the
              Portal as Update payment method, where Stripe also cancels. */}
          {status === "past_due" ? "Update payment method" : "Manage in Stripe"}
        </span>{" "}
        above. Stripe asks you to confirm before anything changes.
      </>
    );
  } else if (statusQuery.isSuccess) {
    cancelLine = (
      <>
        Frapp turned this plan on, so there is nothing to cancel in Stripe. To
        change it, write to {email}.
      </>
    );
  }

  return (
    <ProfileSection id="plan-cancel-or-close" title="Cancel or close">
      <div className="max-w-2xl space-y-2 text-sm text-muted-foreground">
        {cancelLoading ? (
          <Skeleton className="h-4 w-72 max-w-full" />
        ) : cancelLine ? (
          <p>{cancelLine}</p>
        ) : null}
        <p>
          To close the chapter for good, write to {email}. Its history is kept,
          locked for editing.
        </p>
      </div>
    </ProfileSection>
  );
}

/**
 * The one-line lapse banner, board `4d` note 4.
 *
 * The note reads: "Past-due state swaps the chip to destructive and adds a
 * one-line banner at the top of **this page only**." Both halves are taken
 * literally. The chip is `PlanPanel`'s and already swaps, because
 * `subscriptionStatusKind` maps the lapsed statuses to `destructive` and has
 * since #841. This is the banner, it is one line, and it is mounted here and
 * nowhere else — no gated control anywhere in the app grows a second copy;
 * those keep the per-control `SubscriptionNotice` they already have.
 *
 * **It fires on `canceled` too, which is a generalisation of the board rather
 * than a departure from it.** `4d` models two states, Active and Past due. The
 * product has four, and the rule the note is really stating is "the destructive
 * state gets a banner". `subscriptionStatusKind` is the existing definition of
 * which states those are, so the banner keys on it instead of on a second,
 * drifting list. `incomplete` takes `warning` there — a chapter that never
 * started is not a chapter that lapsed — and its whole story is the plan
 * panel's "Complete checkout" directly below, so it gets no banner.
 *
 * `null` renders nothing: an unresolved status must never produce a blocked
 * explanation, because that asserts a reason nothing proved.
 */
function PastDueBanner({ status }: { status: string | null }) {
  if (status === null) return null;
  if (subscriptionStatusKind(status) !== "destructive") return null;

  /*
    Not a live region, deliberately. A `role="status"` announces a *change*,
    and this never changes after mount: it is durable page content that is
    simply present whenever the chapter is lapsed. Marking it one put a third
    polite announcement into the queue a screen-reader user hears on arrival,
    behind the loading state and ahead of the invoice list's own notices — for
    a sentence that is the second thing on the page anyway, right under the
    heading, and that they will reach by reading.
  */
  return (
    <p className="flex items-center gap-2 rounded-md border border-destructive/45 bg-destructive-tint px-3 py-2 text-sm text-destructive-text">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {status === "canceled"
        ? "This chapter's subscription is canceled and the chapter is read-only."
        : "This chapter's subscription is past due. Write actions stay blocked until payment clears."}
    </p>
  );
}
