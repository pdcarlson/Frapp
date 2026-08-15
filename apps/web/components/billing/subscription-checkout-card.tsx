"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useBillingStatus, useCreateCheckout, useCurrentUser } from "@repo/hooks";
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
import { isSubscriptionStatus, type SubscriptionStatus } from "@/lib/subscription";

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

function lockedCopy(status: SubscriptionStatus): {
  title: string;
  description: string;
  cta: string;
} {
  switch (status) {
    case "past_due":
      return {
        title: "Payment is past due",
        description:
          "Chapter subscription is past due; write actions are blocked until payment is resolved. Complete checkout to restore them.",
        cta: "Resolve payment",
      };
    case "canceled":
      return {
        title: "Subscription canceled",
        description:
          "This chapter is read-only. Start a new subscription to unlock dues, invoices, and the rest of the paid modules.",
        cta: "Restart subscription",
      };
    default:
      return {
        title: "Activate your chapter subscription",
        description:
          "Chapter subscription is not active; complete checkout to use this feature. Dues, invoices, and the paid modules unlock as soon as payment clears.",
        cta: "Complete checkout",
      };
  }
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
 * Reads its own state through the same query keys the billing page already
 * mounts, so mounting it costs no extra request.
 */
export function SubscriptionCheckoutCard() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const outcome = readOutcome(searchParams.get("checkout"));

  const statusQuery = useBillingStatus();
  const currentUserQuery = useCurrentUser();
  const createCheckout = useCreateCheckout();

  const rawStatus = (statusQuery.data as { status?: unknown } | undefined)
    ?.status;
  const status: SubscriptionStatus = isSubscriptionStatus(rawStatus)
    ? rawStatus
    : "incomplete";
  const isActive = status === "active";

  // Each tick schedules the next by advancing `attempt`, so the effect stops
  // on its own once the status flips or the budget runs out.
  const [attempt, setAttempt] = useState(0);
  const awaitingActivation = outcome === "success" && !isActive;
  const isPolling = awaitingActivation && attempt < ACTIVATION_POLL_ATTEMPTS;
  const { refetch } = statusQuery;

  useEffect(() => {
    if (!isPolling) return;
    const timer = setTimeout(() => {
      void refetch();
      setAttempt((n) => n + 1);
    }, ACTIVATION_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [isPolling, attempt, refetch]);

  async function startCheckout() {
    const email = (currentUserQuery.data as { email?: string } | undefined)
      ?.email;
    if (!email) {
      toast({
        title: "Couldn't start checkout",
        description:
          "Your account email hasn't loaded yet. Retry in a moment.",
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

  if (isActive && outcome !== "success") return null;

  if (isActive) {
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

  if (awaitingActivation) {
    const stillWaiting = attempt >= ACTIVATION_POLL_ATTEMPTS;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {stillWaiting ? null : <Loader2 className="h-4 w-4 animate-spin" />}
            {stillWaiting
              ? "Payment received — activation is still pending"
              : "Payment received — activating your chapter"}
          </CardTitle>
          <CardDescription>
            {stillWaiting
              ? "Stripe has your payment, but the confirmation hasn't reached us yet. Refresh in a minute; if the chapter is still locked after that, contact support with your Stripe receipt."
              : "Stripe confirms subscriptions in the background, so this can take a few seconds. Paid features unlock as soon as it lands."}
          </CardDescription>
        </CardHeader>
        {stillWaiting ? (
          <CardContent>
            <Button variant="outline" onClick={() => void refetch()}>
              Check again
            </Button>
          </CardContent>
        ) : null}
      </Card>
    );
  }

  const copy = lockedCopy(status);

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-lg">{copy.title}</CardTitle>
        <CardDescription>
          {copy.description}
          {outcome === "cancelled"
            ? " Your last checkout was cancelled — no charge was made."
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Can
          permission="billing:manage"
          deniedFallback={
            <p className="text-sm text-muted-foreground">
              A chapter officer with <code>billing:manage</code> can complete
              checkout and unlock these features.
            </p>
          }
        >
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
            {copy.cta}
          </Button>
        </Can>
      </CardContent>
    </Card>
  );
}
