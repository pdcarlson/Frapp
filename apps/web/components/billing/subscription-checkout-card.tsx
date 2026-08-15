"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useCreateCheckout, useCreatePortal, useCurrentUser } from "@repo/hooks";
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

/**
 * Stripe confirms the subscription over a webhook, not on the redirect, so the
 * chapter is briefly still `incomplete` when the user lands back here. Poll for
 * the flip instead of asserting it (#860). Bounded on purpose: an unbounded
 * poll on a webhook that never arrives is an invisible failure.
 */
const ACTIVATION_POLL_INTERVAL_MS = 3_000;
const ACTIVATION_POLL_ATTEMPTS = 10;

type CheckoutOutcome = "success" | "cancelled" | null;

function readOutcome(value: string | null): CheckoutOutcome {
  if (value === "success") return "success";
  if (value === "cancelled") return "cancelled";
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
 * **Checkout is offered for `incomplete` only.** A chapter that has lapsed to
 * `past_due` or `canceled` already has a Stripe customer and a subscription,
 * and `POST /v1/billing/checkout` rejects only `active`
 * (`billing.service.ts:112`) while `StripeService.createCheckoutSession` passes
 * `customer_email` rather than the stored `stripe_customer_id` — so a second
 * checkout mints a second customer and a second live subscription while Stripe
 * keeps dunning the first. `spec/behavior/billing.md` promises those are
 * deduplicated; they are not. Lapsed chapters therefore go to the Customer
 * Portal, which is both the correct recovery (update the card on the existing
 * subscription) and incapable of double-subscribing.
 */
export function SubscriptionCheckoutCard() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const outcome = readOutcome(searchParams.get("checkout"));

  const { status, isPending, isError } = useChapterSubscription();
  const currentUserQuery = useCurrentUser();
  const createCheckout = useCreateCheckout();
  const createPortal = useCreatePortal();

  // Only `incomplete` can be waiting on a first activation. Keying this on the
  // URL param alone let a stale `/billing?checkout=success` bookmark hijack the
  // screen of a chapter that had since lapsed, hiding its recovery path.
  const awaitingActivation = outcome === "success" && status === "incomplete";

  // Each tick schedules the next by advancing `attempt`, so the effect stops
  // on its own once the status flips or the budget runs out.
  const [attempt, setAttempt] = useState(0);
  const isPolling = awaitingActivation && attempt < ACTIVATION_POLL_ATTEMPTS;

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
        return_url: `${window.location.origin}/billing`,
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
  if (isPending || isError || status === null) return null;

  if (status === "active") {
    if (outcome !== "success") return null;
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

  if (awaitingActivation && attempt < ACTIVATION_POLL_ATTEMPTS) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            Payment received — activating your chapter
          </CardTitle>
          <CardDescription>
            Stripe confirms subscriptions in the background, so this can take a
            few seconds. Paid features unlock as soon as it lands.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lapsed = status === "past_due" || status === "canceled";

  return (
    <Card className="border-primary/40">
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
              ? "This chapter is read-only. Reopen the subscription from the billing portal to unlock dues, invoices, and the paid modules."
              : "Chapter subscription is not active; complete checkout to use this feature. Dues, invoices, and the paid modules unlock as soon as payment clears."}
          {outcome === "cancelled" && !lapsed
            ? " Your last checkout was cancelled — no charge was made."
            : null}
          {awaitingActivation
            ? " Stripe has your payment, but the confirmation hasn't reached us yet. If the chapter is still locked in a minute, contact support with your Stripe receipt."
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Can
          permission="billing:manage"
          deniedFallback={
            <p className="text-sm text-muted-foreground">
              A chapter officer with <code>billing:manage</code> can{" "}
              {lapsed ? "resolve this" : "complete checkout"} and unlock these
              features.
            </p>
          }
        >
          {lapsed ? (
            <Button
              onClick={() => void openPortal()}
              disabled={createPortal.isPending}
              className="gap-2"
            >
              {createPortal.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
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
                <CreditCard className="h-4 w-4" />
              )}
              Complete checkout
            </Button>
          )}
        </Can>
      </CardContent>
    </Card>
  );
}
