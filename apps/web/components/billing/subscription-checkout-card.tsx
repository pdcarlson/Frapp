"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { BillingGlyph } from "@/components/layout/nav-glyphs";
import {
  useCreateCheckout,
  useCreatePortal,
  useCurrentUser,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import { useChapterSubscription } from "@/lib/hooks/use-subscription-write-state";
import { subscriptionStatusKind } from "@/components/billing/invoice-status";

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
 * The chapter's way out of `subscription_status: incomplete` (#860).
 *
 * `BillingController` is `@SubscriptionExempt()` precisely so this path stays
 * reachable while everything else is locked — `spec/ui/design-system/README.md`
 * §5 rule 3, "never gate a user out of the screen that ungates them". Before
 * this card existed the API kept that door open and the client never built it,
 * so a chapter could complete onboarding and never reach `active`.
 *
 * **Recovery splits by status, and the split is load-bearing (#929).**
 *
 * - `past_due` → **Customer Portal.** The subscription is live and in dunning,
 *   so updating the payment method resolves it in place. `POST
 *   /v1/billing/checkout` now refuses this status outright: a second checkout
 *   would bill the chapter twice and orphan the first subscription.
 * - `canceled` → **checkout.** A canceled subscription is terminal at Stripe,
 *   and the Portal cannot resume one — it only reactivates a subscription still
 *   scheduled to cancel at period end, which our status map reports as
 *   `active`. Checkout is the chapter's only way back. It is safe because the
 *   server reuses the chapter's stored `stripe_customer_id`, so the returning
 *   chapter keeps one continuous customer instead of forking a second, and
 *   there is no live subscription left to orphan.
 *
 * This card previously sent both lapsed statuses to the Portal and told a
 * `canceled` chapter to "reopen the subscription" there — a dead end.
 */
export function SubscriptionCheckoutCard() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const outcome = readOutcome(searchParams.get("checkout"));

  // `status` alone is the gate: it is null exactly when nothing has been
  // established (loading, failed with no cache, no chapter, or an unmodeled
  // value), and non-null whenever there is a cached answer worth rendering.
  const { status } = useChapterSubscription();
  const currentUserQuery = useCurrentUser();
  const createCheckout = useCreateCheckout();
  const createPortal = useCreatePortal();

  const lapsed = status === "past_due" || status === "canceled";
  // Which recovery this chapter gets. `lapsed` still covers both statuses for
  // the returned-from-portal banner below; only `past_due` is actually routed
  // to the Portal (#929) — see the split in the block comment above.
  const usesPortal = status === "past_due";
  // The statuses that recover *through* checkout. `canceled` joined this set
  // with #929, and it has to be named here as well as on the button: the
  // post-checkout poll below keys on it, and a canceled chapter that had just
  // paid would otherwise fall through to the lapsed card and be told to start
  // another subscription seconds after starting one.
  const usesCheckout = status === "incomplete" || status === "canceled";

  // Two ways to be waiting on Stripe: a first activation via Checkout, or a
  // lapsed chapter that just fixed its payment in the Portal. Both confirm over
  // a webhook, so both need the poll — otherwise the page sits on a stale
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

  useEffect(() => {
    if (!isPolling) return;
    const timer = setTimeout(() => {
      // Invalidate rather than refetch one query: `subscription_status` is read
      // by the chapter payload (this card, every subscription gate) and by
      // `/v1/billing/status` (the IDs on this page). Refreshing only one leaves
      // the page contradicting itself for the chapter query's 5-minute
      // staleTime — "Subscription active" above a control still saying the
      // chapter is not subscribed.
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

  // Fail open, matching `useSubscriptionWriteState`. An unresolved status is
  // most likely a paying chapter behind a slow or failed fetch, and telling one
  // its subscription is inactive — then offering a checkout button that 400s
  // with "already has an active subscription" — is worse than showing nothing.
  //
  // Deliberately keyed on `status` alone rather than on `isPending`/`isError`:
  // a query that already has data and then fails a background refetch reports
  // `isError` while retaining that data, and blanking the card there would
  // remove the only control that unlocks the chapter (§5 rule 3).
  if (status === null) return null;

  if (status === "active") {
    if (outcome !== "success" && outcome !== "returned") return null;
    return (
      <Card className="border-success/45 bg-success/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-4 w-4" />
            Subscription active
          </CardTitle>
          <CardDescription>
            Payment cleared and every paid module is unlocked for this chapter.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (awaiting) {
    const exhausted = attempt >= ACTIVATION_POLL_ATTEMPTS;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {exhausted ? null : <Loader2 className="h-4 w-4 animate-spin" />}
            {exhausted
              ? "Still waiting on Stripe"
              : outcome === "returned"
                ? "Checking Stripe for your update"
                : "Payment received — activating your chapter"}
          </CardTitle>
          <CardDescription>
            {exhausted
              ? "Stripe hasn't confirmed yet. This is usually a short delay — check again below. If it persists, contact support with your Stripe receipt rather than paying a second time."
              : "Stripe confirms changes in the background, so this can take a few seconds. Paid features unlock as soon as it lands."}
          </CardDescription>
        </CardHeader>
        {exhausted ? (
          <CardContent className="flex flex-wrap items-center gap-3">
            {/*
              Deliberately NOT a checkout button. This branch is reached by a
              chapter that has just paid and whose webhook has not landed yet,
              so its stored status is still `incomplete` or `canceled` — the
              two the server accepts for checkout (#929). The duplicate guard
              therefore cannot catch a second attempt from here; only the
              absence of the button can. Re-checking is the safe recovery;
              someone who never actually paid can clear the stale return marker
              instead.
            */}
            <Button
              variant="secondary"
              onClick={() => {
                setAttempt(0);
                void queryClient.invalidateQueries({ queryKey: ["chapters"] });
                void queryClient.invalidateQueries({ queryKey: ["billing"] });
              }}
            >
              Check again
            </Button>
            {/* `h-auto px-0` cancels the size's box classes, which `link` does
                not reset — without them the anchor renders as a 44px padded
                block beside the button rather than as inline text. Same pairing
                as `service-page.tsx`'s proof link. */}
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <a href="/billing">I haven&apos;t paid yet</a>
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  // `past_due` and `canceled` are a working subscription that regressed —
  // §5's danger. `incomplete` never started, so it takes the warning (amber)
  // tone rather than reading as a lapse. `status` is narrowed to those three
  // values by this point (`null` and `active` both return above), so
  // `subscriptionStatusKind` only ever answers `warning` or `destructive`
  // here. Reuses that mapper (`invoice-status.ts`) rather than a second
  // status→tone mapping.
  const cardToneClassName =
    subscriptionStatusKind(status) === "destructive"
      ? "border-destructive/45 bg-destructive/10"
      : "border-warning/45 bg-warning/10";

  return (
    <Card className={cardToneClassName}>
      <CardHeader>
        <CardTitle className="text-lg">
          {status === "past_due"
            ? "Payment past due"
            : status === "canceled"
              ? "Subscription canceled"
              : "Activate your chapter subscription"}
        </CardTitle>
        <CardDescription>
          {status === "past_due"
            ? "Chapter subscription is past due; write actions are blocked until payment is resolved. Update your payment method to restore them."
            : status === "canceled"
              ? "This chapter is read-only. Start a new subscription to unlock dues, invoices, and the paid modules again — your billing history is preserved."
              : "Chapter subscription is not active; complete checkout to use this feature. Dues, invoices, and the paid modules unlock as soon as payment clears."}
          {outcome === "cancelled" && !usesPortal
            ? " Your last checkout was cancelled — no charge was made."
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Can
          permission="billing:manage"
          deniedFallback={
            <p className="text-sm text-muted-foreground">
              A chapter officer with <code>billing:manage</code> can{" "}
              {usesPortal ? "resolve this" : "complete checkout"} and unlock
              these features.
            </p>
          }
        >
          {usesPortal ? (
            <Button
              onClick={() => void openPortal()}
              disabled={createPortal.isPending}
              className="gap-2"
            >
              {createPortal.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BillingGlyph className="h-4 w-4" />
              )}
              Manage billing in Stripe
            </Button>
          ) : (
            <Button
              onClick={() => void startCheckout()}
              disabled={createCheckout.isPending}
              className="gap-2"
            >
              {createCheckout.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BillingGlyph className="h-4 w-4" />
              )}
              Complete checkout
            </Button>
          )}
        </Can>
      </CardContent>
    </Card>
  );
}
