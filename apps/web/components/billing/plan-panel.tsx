"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { BillingGlyph } from "@/components/layout/nav-glyphs";
import {
  useBillingStatus,
  useCreateCheckout,
  useCreatePortal,
  useCurrentUser,
  useMyPermissions,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { useChapterSubscription } from "@/lib/hooks/use-subscription-write-state";
import {
  subscriptionStatusKind,
  subscriptionStatusLabel,
} from "@/components/billing/invoice-status";
import { formatBareDate } from "@repo/formatting";

/**
 * Stripe confirms the subscription over a webhook, not on the redirect, so the
 * chapter is briefly still `incomplete` when the user lands back here. Poll for
 * the flip instead of asserting it (#860). Bounded on purpose: an unbounded
 * poll on a webhook that never arrives is an invisible failure.
 */
const ACTIVATION_POLL_INTERVAL_MS = 3_000;
const ACTIVATION_POLL_ATTEMPTS = 10;

type CheckoutOutcome = "success" | "cancelled" | "returned" | null;

function readOutcome(value: string | null): CheckoutOutcome {
  if (value === "success") return "success";
  if (value === "cancelled") return "cancelled";
  if (value === "returned") return "returned";
  return null;
}

/**
 * Mirrors what `BillingService.getChapterBillingStatus` actually returns. The
 * Stripe identifiers have no other source; `subscription_status` on it is a
 * display fallback only (#841).
 */
type BillingStatusPreview = {
  subscription_status?: string;
  stripe_customer_id?: string | null;
  subscription_id?: string | null;
};

/**
 * The plan panel, board `4d`.
 *
 * **One panel, where there were two cards.** `/billing` used to render a
 * `SubscriptionCheckoutCard` above a "Subscription Status" card, and the two
 * described the same fact: the first said what was wrong and offered the fix,
 * the second restated the status in a badge beside two Stripe ids. `4d` draws
 * one block carrying the plan, its status chip and its actions, so the two
 * collapse into this. `subscription-checkout-card.tsx` is deleted in the same
 * change, per the cutover rule — every behaviour it owned is below, and each
 * one names the issue it came from so a reader can check nothing was dropped.
 *
 * **What the board draws that this cannot.** `4d`'s card carries `$3 per member
 * / month`, `42 members`, `renews Jan 5, 2027`, `Visa ····4242` and
 * `Next charge $126.00`. Not one of those five has a source: the chapter
 * payload carries `subscription_status` and `past_due_since`, and
 * `GET /v1/billing/status` adds a customer id and a subscription id. There is
 * no price, no seat count, no renewal date, no payment method and no upcoming
 * invoice anywhere in the contract. They are therefore **omitted**, not
 * placeholdered: a row reading "Next charge —" claims we know there is one.
 * Wiring them is a billing-contract change and belongs to whoever adds the
 * Stripe read, not to a chrome lane.
 *
 * **And what it draws that the product does not have.** `4d` is a two-tier
 * screen — Starter, with an "Upgrade to Pro" primary. This product has one
 * paid subscription and `MODULE_CATALOG` splits modules `free` / `paid`, so
 * there is no Starter to be on and no Pro to upgrade *to*: the chapter either
 * holds the subscription or does not. The primary action is therefore the
 * recovery for the status the chapter is actually in, which is the `#929`
 * split this panel inherits, and never an upgrade button pointed at a tier
 * that cannot be bought. See `plan-matrix.tsx` for the same call one block
 * down.
 *
 * **Recovery splits by status, and the split is load-bearing (#929).**
 *
 * - `past_due` → **Customer Portal.** The subscription is live and in dunning,
 *   so updating the payment method resolves it in place. `POST
 *   /v1/billing/checkout` refuses this status outright: a second checkout
 *   would bill the chapter twice and orphan the first subscription.
 * - `canceled` → **checkout.** A canceled subscription is terminal at Stripe,
 *   and the Portal cannot resume one — it only reactivates a subscription still
 *   scheduled to cancel at period end, which our status map reports as
 *   `active`. Checkout is the chapter's only way back. It is safe because the
 *   server reuses the chapter's stored `stripe_customer_id`, so the returning
 *   chapter keeps one continuous customer instead of forking a second, and
 *   there is no live subscription left to orphan.
 *
 * **Both Stripe actions stay blocking, and nothing here is optimistic.** Each
 * awaits its `mutateAsync`, disables its own button for the duration, and hands
 * off with `window.location.assign`. Neither one moves the status chip; the
 * chip only ever reports what the chapter record says. The poll below exists
 * precisely because the alternative — asserting `active` on the redirect — is
 * the fake optimism this screen must not have.
 *
 * `BillingController` is `@SubscriptionExempt()` so this path stays reachable
 * while everything else is locked: `spec/ui/design-system/README.md` §5 rule 3,
 * "never gate a user out of the screen that ungates them".
 */
export function PlanPanel({ invoicesHref }: { invoicesHref?: string }) {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const outcome = readOutcome(searchParams.get("checkout"));

  // One reader for subscription state across the whole client (§5, "read
  // subscription state from one place"). `GET /v1/billing/status` and the
  // chapter payload are two caches over one fact and resolve independently, so
  // the chip reads the chapter record — the same source every *gate* reads —
  // and falls back to the billing payload only when the chapter record has not
  // established anything. The fallback is display-only: no gate reads it.
  const { status, pastDueSince } = useChapterSubscription();
  const statusQuery = useBillingStatus();
  const billingStatus = statusQuery.data as BillingStatusPreview | undefined;
  const shownStatus = status ?? billingStatus?.subscription_status;

  /*
   * A **failed** `GET /v1/billing/status`, told apart from the 403 that is its
   * ordinary outcome.
   *
   * The ids below are omitted when absent, which is right for a member: the
   * endpoint is class-level `@RequirePermissions(billing:view)` and most
   * members do not hold it, so their `isError` is the expected answer and a
   * warning about it would fire on every load for most of the userbase. That
   * is what the page-wide "Showing preview billing data" banner this lane
   * deleted actually did.
   *
   * But `isError` is also what a 500 looks like to a treasurer who *does* hold
   * `billing:view`, and for them absence-as-403 is wrong: the panel would
   * render exactly as it does for a member, with no signal and no retry, and
   * a chapter that is wired to Stripe would read as one that never was. The
   * permission is the thing that separates the two cases, and `<Can>` below
   * already puts `useMyPermissions` in this component's cache, so reading it
   * here costs no request.
   */
  const { data: permissionsPayload } = useMyPermissions();
  const statusReadFailed =
    statusQuery.isError &&
    can("billing:view", permissionsPayload?.permissions ?? []);

  const currentUserQuery = useCurrentUser();
  const createCheckout = useCreateCheckout();
  const createPortal = useCreatePortal();

  const lapsed = status === "past_due" || status === "canceled";
  // Which recovery this chapter gets. `lapsed` still covers both statuses for
  // the returned-from-portal poll below; only `past_due` is actually routed to
  // the Portal (#929) — see the block comment above.
  const usesPortal = status === "past_due";
  // The statuses that recover *through* checkout. `canceled` joined this set
  // with #929, and it has to be named here as well as on the button: the
  // post-checkout poll keys on it, and a canceled chapter that had just paid
  // would otherwise fall through to the recovery row and be told to start
  // another subscription seconds after starting one.
  const usesCheckout = status === "incomplete" || status === "canceled";

  // Two ways to be waiting on Stripe: a first activation via Checkout, or a
  // lapsed chapter that just fixed its payment in the Portal. Both confirm over
  // a webhook, so both need the poll — otherwise the panel sits on a stale
  // `past_due` for the chapter query's five-minute staleTime.
  //
  // Keyed on the status as well as the URL param: keying on the param alone let
  // a stale `/billing?checkout=success` bookmark hijack the screen of a chapter
  // that had since lapsed, hiding its recovery path.
  const awaiting =
    (outcome === "success" && usesCheckout) ||
    (outcome === "returned" && lapsed);

  // Each tick schedules the next by advancing `attempt`, so the effect stops
  // on its own once the status flips or the budget runs out.
  const [attempt, setAttempt] = useState(0);
  const isPolling = awaiting && attempt < ACTIVATION_POLL_ATTEMPTS;

  /*
   * Did this visit actually *watch* the chapter go from not-active to active?
   *
   * It matters because **this lane added a Portal button to the `active`
   * branch**, and that button's `return_url` is `/billing?checkout=returned`.
   * Before it existed, an active chapter could not land on `?checkout=returned`
   * at all: the card this panel replaces offered the Portal only in its lapsed
   * branch, and the one other portal in the app
   * (`settings-page.tsx`) returns to `/settings`. So `active + returned` could
   * only mean the intended dunning recovery — lapsed chapter fixes its card,
   * webhook lands, status flips — and printing "Payment cleared" for it was
   * true by construction.
   *
   * It is not any more. A treasurer on a healthy chapter who opens the Portal
   * to download a receipt, change the billing address, or *cancel*, and then
   * clicks Return, arrives at exactly that URL with nothing having been paid —
   * and a green checkmark reading "Payment cleared" is the fake optimism this
   * screen exists not to have.
   *
   * `success` is unaffected and stays unconditional: that URL is
   * `createCheckout`'s own `success_url`, so the caller did go through
   * checkout. `returned` now has to earn it by having rendered the awaiting
   * state first, which only happens when the status was lapsed on arrival.
   */
  const [sawActivation, setSawActivation] = useState(false);
  useEffect(() => {
    if (!awaiting) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch that this visit rendered the awaiting state, so the confirmation below is about a flip we witnessed
    setSawActivation(true);
  }, [awaiting]);

  useEffect(() => {
    if (!isPolling) return;
    const timer = setTimeout(() => {
      // Invalidate rather than refetch one query: `subscription_status` is read
      // by the chapter payload (this panel, every subscription gate) and by
      // `/v1/billing/status` (the ids below). Refreshing only one leaves the
      // page contradicting itself for the chapter query's 5-minute staleTime.
      void queryClient.invalidateQueries({ queryKey: ["chapters"] });
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
      setAttempt((n) => n + 1);
    }, ACTIVATION_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [isPolling, attempt, queryClient]);

  async function startCheckout() {
    const email = (currentUserQuery.data as { email?: string } | undefined)
      ?.email;
    if (!email) {
      toast({
        title: "Couldn't start checkout",
        description: "Your account email hasn't loaded yet. Retry in a moment.",
        variant: "destructive",
      });
      return;
    }

    try {
      const origin = window.location.origin;
      const result = await createCheckout.mutateAsync({
        customer_email: email,
        success_url: `${origin}/billing?checkout=success`,
        cancel_url: `${origin}/billing?checkout=cancelled`,
      });
      const url =
        result && typeof result === "object" && "url" in result
          ? (result as { url?: string }).url
          : null;
      if (!url) throw new Error("Checkout did not return a URL.");
      window.location.assign(url);
    } catch (error) {
      toast({
        title: "Couldn't start checkout",
        description: getErrorMessage(
          error,
          "Confirm billing:manage permission and retry.",
        ),
        variant: "destructive",
      });
    }
  }

  async function openPortal() {
    try {
      const result = await createPortal.mutateAsync({
        return_url: `${window.location.origin}/billing?checkout=returned`,
      });
      const url =
        result && typeof result === "object" && "url" in result
          ? (result as { url?: string }).url
          : null;
      if (!url) throw new Error("Billing portal did not return a URL.");
      window.location.assign(url);
    } catch (error) {
      toast({
        title: "Couldn't open billing portal",
        description: getErrorMessage(
          error,
          "Confirm billing:manage permission and an active Stripe customer.",
        ),
        variant: "destructive",
      });
    }
  }

  const exhausted = attempt >= ACTIVATION_POLL_ATTEMPTS;

  return (
    /*
      `--surface-1` at radius 16 with a hairline, which is `4d`'s own
      `#1A1A1A` / `rgba(255,255,255,.08)` / `border-radius:16px` and **not** the
      `<Card>` primitive: `card.tsx` paints `--card` (`#211E1A`), one rung up
      the ladder from what the board draws here. This is the only framed block
      the board puts on the page, and it earns the frame by being the one thing
      on the screen that is not a list.
    */
    <section
      aria-labelledby="plan-panel-heading"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5 sm:flex-row sm:items-center sm:gap-6"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {/*
            22/700 is `4d`'s plan name. It is an `<h2>`, not the route's `<h1>`:
            `PageHeader` owns that, and one typographic anchor per screen is its
            whole contract.
          */}
          <h2
            id="plan-panel-heading"
            className="text-[22px] font-bold leading-tight tracking-[-0.3px]"
          >
            Pro
          </h2>
          {/*
            The semantic chip, which `4d` note 4 swaps to destructive when the
            chapter lapses. `subscriptionStatusKind` already does exactly that
            for `past_due` and `canceled`, so the board's rule needs no second
            mapping here — and an unestablished status takes the Hairline kind,
            which §5 reserves for "quiet metadata that must not read as a
            status". That is the one honest answer while nothing is known.
          */}
          <Badge variant={subscriptionStatusKind(shownStatus)}>
            {subscriptionStatusLabel(shownStatus)}
          </Badge>
        </div>

        <PlanMeta
          status={status}
          pastDueSince={pastDueSince}
          billingStatus={billingStatus}
          invoicesHref={invoicesHref}
        />

        {statusReadFailed ? (
          <p
            role="status"
            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground"
          >
            Couldn&apos;t load this chapter&apos;s Stripe details.
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => void statusQuery.refetch()}
            >
              Retry
            </Button>
          </p>
        ) : null}

        {outcome === "cancelled" && !usesPortal ? (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Your last checkout was cancelled. No charge was made.
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        {awaiting ? (
          <ActivationWait
            exhausted={exhausted}
            outcome={outcome}
            onRecheck={() => {
              setAttempt(0);
              void queryClient.invalidateQueries({ queryKey: ["chapters"] });
              void queryClient.invalidateQueries({ queryKey: ["billing"] });
            }}
          />
        ) : status === null ? (
          /*
            Fail open, matching `useSubscriptionWriteState`. An unresolved
            status is most likely a paying chapter behind a slow or failed
            fetch, and offering it a checkout button that 400s with "already has
            an active subscription" is worse than offering nothing. Keyed on
            `status` alone rather than on `isPending`/`isError`: a query that
            already has data and then fails a background refetch reports
            `isError` while retaining that data, and blanking the control there
            would remove the only thing that unlocks the chapter (§5 rule 3).
          */
          null
        ) : status === "active" ? (
          <>
            {outcome === "success" ||
            (outcome === "returned" && sawActivation) ? (
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Payment cleared
              </p>
            ) : null}
            <StripeAction
              label="Manage in Stripe"
              variant="secondary"
              pending={createPortal.isPending}
              onRun={openPortal}
              askAnOfficer="Ask an officer to manage the subscription in Stripe."
            />
          </>
        ) : usesPortal ? (
          <StripeAction
            label="Update payment method"
            variant="default"
            pending={createPortal.isPending}
            onRun={openPortal}
            askAnOfficer="Ask an officer to update the payment method."
          />
        ) : (
          <StripeAction
            label={status === "canceled" ? "Restart subscription" : "Complete checkout"}
            variant="default"
            pending={createCheckout.isPending}
            onRun={startCheckout}
            askAnOfficer={
              status === "canceled"
                ? "Ask an officer to restart the subscription."
                : "Ask an officer to complete checkout."
            }
          />
        )}
      </div>
    </section>
  );
}

/**
 * The meta line under the plan name, holding only facts that exist.
 *
 * `4d` puts price, seats, renewal, card and next charge here. None of them has
 * a source (see the panel's docblock), so what is left is the lapse date and
 * the two Stripe identifiers — and each is conditional, because each is
 * genuinely absent some of the time. `GET /v1/billing/status` is class-level
 * `@RequirePermissions(billing:view)`, which most members do not hold, so for
 * them the ids are permanently `undefined`: the old card rendered them as three
 * bordered boxes reading "—", which is three pieces of chrome telling a member
 * nothing. They are dropped instead.
 */
function PlanMeta({
  status,
  pastDueSince,
  billingStatus,
  invoicesHref,
}: {
  status: string | null;
  pastDueSince: string | null;
  billingStatus: BillingStatusPreview | undefined;
  invoicesHref?: string;
}) {
  const lapsedOn =
    status === "past_due" && pastDueSince
      ? formatBareDate(pastDueSince)
      : null;
  const customerId = billingStatus?.stripe_customer_id ?? null;
  const subscriptionId = billingStatus?.subscription_id ?? null;

  /*
   * Keyed by name, not by array index, and the difference is reachable rather
   * than theoretical. Entries are inserted at the **front** of this list as
   * they become available, so an index key shifts every later entry's identity
   * — and the last entry is a focusable anchor. React reconciling by index
   * replaces the DOM node that held focus instead of moving it.
   *
   * The trigger is this panel's own poll: it invalidates `["billing"]` every
   * 3s, so an officer waiting out a checkout can tab onto Invoices at index 0
   * and have the Stripe ids arrive on the next tick, pushing it to index 2 and
   * dropping focus to `<body>`.
   */
  const items: { key: string; node: React.ReactNode }[] = [];
  if (lapsedOn) {
    items.push({ key: "lapsed", node: <>Past due since {lapsedOn}</> });
  }
  if (customerId) {
    items.push({
      key: "customer",
      node: (
        <>
          Customer <span className="font-mono">{customerId}</span>
        </>
      ),
    });
  }
  if (subscriptionId) {
    items.push({
      key: "subscription",
      node: (
        <>
          Subscription <span className="font-mono">{subscriptionId}</span>
        </>
      ),
    });
  }
  if (invoicesHref) {
    items.push({
      key: "invoices",
      node: (
        <a
          href={invoicesHref}
          className="font-semibold underline underline-offset-4"
        >
          Invoices
        </a>
      ),
    });
  }

  if (items.length === 0) return null;

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
      {items.map((item, index) => (
        <span key={item.key} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {item.node}
        </span>
      ))}
    </p>
  );
}

/**
 * A Stripe hand-off, gated on `billing:manage` and blocking for its whole life.
 *
 * The denied copy is board `4b`'s: "Members without billing rights see 'Ask an
 * officer'." It replaces the old `deniedFallback`, which read "A chapter
 * officer with `billing:manage` can complete checkout and unlock these
 * features" — a permission key quoted at someone who cannot act on it.
 *
 * **Only `deniedFallback` gets it, and the other two slots are deliberately
 * left alone.** An earlier cut of this file passed the same node to all three,
 * reasoning by analogy with `subscription-gate.tsx`'s `DefaultRecovery`
 * ("naming someone who can fix it beats naming nobody"). That reasoning is
 * about a *notice*, whose whole job is to name a recovery. This slot is the
 * action itself, and `can.tsx` documents the three branches as three different
 * facts:
 *
 * - `deniedFallback` — **proved** they do not hold it. "Ask an officer" is
 *   exactly right, and is the only branch that has established anything.
 * - `fallback` — idle, nothing cached. Nothing is established, so it stays
 *   `null` and the slot is briefly empty, as the card this replaces left it.
 *   The alternative told a treasurer holding `billing:manage` to ask an
 *   officer, for the length of their own permission fetch.
 * - `offlineFallback` — paused, cannot check. Omitted so `<Can>` supplies its
 *   default, §10's control-slot `PermissionsOffline`: "Offline, can't check
 *   your access", with a Retry that re-arms. Offline, the denied copy was not
 *   briefly wrong but permanently wrong, and carried no way out.
 */
function StripeAction({
  label,
  variant,
  pending,
  onRun,
  askAnOfficer,
}: {
  label: string;
  variant: "default" | "secondary";
  pending: boolean;
  onRun: () => Promise<void>;
  askAnOfficer: string;
}) {
  const denied = (
    <p className="max-w-[15rem] text-[12.5px] text-muted-foreground">
      {askAnOfficer}
    </p>
  );

  return (
    <Can permission="billing:manage" deniedFallback={denied}>
      <Button
        variant={variant}
        onClick={() => void onRun()}
        disabled={pending}
        className="gap-2"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <BillingGlyph className="h-4 w-4" />
        )}
        {label}
      </Button>
    </Can>
  );
}

/**
 * The webhook wait (#860), as a status line rather than the card it used to be.
 *
 * The exhausted branch deliberately offers **no** checkout button. It is
 * reached by a chapter that has just paid and whose webhook has not landed, so
 * its stored status is still `incomplete` or `canceled` — the two the server
 * accepts for checkout (#929). The duplicate guard therefore cannot catch a
 * second attempt from here; only the absence of the button can. Re-checking is
 * the safe recovery, and someone who never actually paid can clear the stale
 * return marker instead.
 */
function ActivationWait({
  exhausted,
  outcome,
  onRecheck,
}: {
  exhausted: boolean;
  outcome: CheckoutOutcome;
  onRecheck: () => void;
}) {
  if (!exhausted) {
    return (
      <p
        role="status"
        className="flex max-w-[15rem] items-center gap-2 text-[12.5px] text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        {outcome === "returned"
          ? "Checking Stripe for your update"
          : "Payment received, activating your chapter"}
      </p>
    );
  }

  return (
    <>
      <p
        role="status"
        className="max-w-[15rem] text-[12.5px] text-muted-foreground"
      >
        Stripe hasn&apos;t confirmed yet. If it persists, contact support with
        your Stripe receipt rather than paying a second time.
      </p>
      <Button variant="secondary" onClick={onRecheck}>
        Check again
      </Button>
      {/* `h-auto px-0` cancels the size's box classes, which `link` does not
          reset — without them the anchor renders as a 44px padded block beside
          the button rather than as inline text. Same pairing as
          `service-page.tsx`'s proof link. */}
      <Button asChild variant="link" size="sm" className="h-auto px-0">
        <a href="/billing">I haven&apos;t paid yet</a>
      </Button>
    </>
  );
}
