"use client";

import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { useCurrentUser, useInvoices } from "@repo/hooks";
import { PageHeader } from "@/components/layout/page-header";
import { anyReadUncached } from "@/components/shared/async-states";
import {
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { PlanPanel } from "@/components/billing/plan-panel";
import { PlanMatrix } from "@/components/billing/plan-matrix";
import { InvoiceList } from "@/components/billing/invoice-list";
import { subscriptionStatusKind } from "@/components/billing/invoice-status";
import { useChapterSubscription } from "@/lib/hooks/use-subscription-write-state";
import { useNetwork } from "@/lib/providers/network-provider";

const INVOICES_ANCHOR = "invoices";

/**
 * Billing, flush on the greenfield shell.
 *
 * **What was deleted.** The route rendered five `<Card>`s: a subscription
 * checkout card, a "Subscription Status" card wrapping three bordered boxes, a
 * preview-data warning card, a "Member Invoices" card holding a table, and
 * `InvoiceAdminCard` holding a second list of the same invoices. `1f` pin 2
 * gives a route's body one toolbar row with "no wrapper card, no description
 * paragraph", and `1t` names the Events "header card, description, filter card,
 * table card, card title, checkbox column" as gone one route over. So the cards
 * and their four narration paragraphs go, and what they wrapped survives on the
 * page surface:
 *
 * | Was | Is |
 * | --- | -- |
 * | `SubscriptionCheckoutCard` + the "Subscription Status" card | one `PlanPanel` (`4d`) |
 * | "Monitor chapter billing health and member invoice progress." | deleted |
 * | "Track dues collection and overdue balances." | deleted |
 * | "Track chapter dues across every member. Stripe webhooks move invoices to PAID automatically." | deleted |
 * | "Stripe webhooks handle automatic PAID transitions. Manual Paid / Void buttons exist for corrections and cash-paid dues." | deleted |
 * | the page's invoice table + `InvoiceAdminCard`'s list | one `InvoiceList` |
 *
 * **The plan matrix is new, and it is the board's** (`4d`). The page had no
 * answer at all to "what does the subscription buy", which is the question a
 * president opens this screen with.
 *
 * **`4d` is a Chapter settings tab, and this is a route.** The board puts
 * Subscription behind a 200px settings rail alongside Accent, Modules, Roles
 * and a Danger zone. Building that rail is Admin, the third of
 * [#2146](https://github.com/pdcarlson/Frapp/issues/2146) and not this PR — so
 * what is taken here is `4d`'s **page body**, on the route the product already
 * has, with `PageHeader` supplying the title the board's rail would have. The
 * sub-nav, and whether `/billing` eventually redirects into it, belong to the
 * Admin lane. `4d`'s sub-line, "Billed to the chapter card. Members never see
 * this page", is therefore **not** taken either: it is narration, and it is
 * false here — `/billing` is gated on `billing:view` and a member reaches it to
 * pay their own invoice, which is why `4b`'s "Ask an officer" has a job to do
 * on this screen at all.
 */
export function BillingPage() {
  const { isOffline } = useNetwork();
  const invoicesQuery = useInvoices();
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
  if (isOffline && anyReadUncached(invoicesQuery, currentUserQuery)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing" />
        {/*
          The **nested** offline state, not the whole-screen one, and on a page
          with no cards left that is the point rather than a technicality.
          `OfflineState` and its siblings paint `--card`; this lane just deleted
          the five `<Card>`s on this route, so rendering one here would put a
          card back through the door the lane closed. Checklist §9 made the same
          swap on `/members` and lane 4 on `/documents`. `sole` because while
          this is up it is the page's only async state, so it needs the live
          region and the heading the nested variant leaves off by default.

          The one exception both lanes kept — a whole-screen variant for a
          branch that genuinely replaces a *page* rather than a list — is the
          no-chapter state, and this is not that: `PageHeader` is still above
          it and the route is still the route.
        */}
        <NestedOffline
          sole
          title="Billing unavailable offline"
          description="Reconnect to sync subscription status and invoice balances."
          onRetry={() => {
            void invoicesQuery.refetch();
            void currentUserQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        `PageHeader` on every path the route can take, including the offline
        one above — the shell no longer supplies a title (#2141), and a page
        that mounts its heading only on the success path loses it exactly when
        the member is most lost.

        No `actions`: `1f` pin 2 puts a route's primary action in this row, and
        this route's is Create invoice — which is gated on both
        `billing:manage` and the subscription, and lives in the invoice list's
        own toolbar beside the filter it shares state with. Hoisting it here
        would put a subscription-gated control above the notice that explains
        why it is disabled.
      */}
      <PageHeader title="Billing" />

      <PastDueBanner status={status} />

      {/*
        `PlanPanel` reads `?checkout=` via `useSearchParams`, which Next
        requires under a Suspense boundary. The fallback is the nested loading
        state rather than the whole-screen one, for the reason
        `members-directory.tsx` gives at its own import: the whole-screen family
        paints `--card`, and this route has one framed block left and it is not
        a card.
      */}
      <Suspense fallback={<NestedLoading message="Loading plan..." />}>
        <PlanPanel invoicesHref={`#${INVOICES_ANCHOR}`} />
      </Suspense>

      <PlanMatrix />

      <InvoiceList id={INVOICES_ANCHOR} />
    </div>
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
    <p className="flex items-center gap-2 rounded-md border border-destructive/45 bg-destructive/[.13] px-3 py-2 text-sm text-destructive-text">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {status === "canceled"
        ? "This chapter's subscription is canceled and the chapter is read-only."
        : "This chapter's subscription is past due. Write actions stay blocked until payment clears."}
    </p>
  );
}
