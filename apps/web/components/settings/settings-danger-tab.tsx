"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useCreatePortal } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BillingGlyph } from "@/components/layout/nav-glyphs";
import { Can } from "@/components/shared/can";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/**
 * Board `4d` pin 1 pins Danger zone last, and this is what it holds: the
 * Stripe portal (where a chapter cancels) and the deactivation route. It was
 * the third card on Organization, which put "cancel the subscription" one
 * scroll under "set your founding year".
 */
export function SettingsDangerTab() {
  const { toast } = useToast();
  const createPortal = useCreatePortal();

  async function openBillingPortal() {
    try {
      const result = await createPortal.mutateAsync({
        return_url:
          typeof window !== "undefined"
            ? `${window.location.origin}/settings`
            : "/settings",
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

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Billing &amp; danger zone
        </CardTitle>
        <CardDescription>
          Manage payment methods, download invoices, or cancel the subscription
          from the Stripe-hosted portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Can
          permission="billing:manage"
          deniedFallback={
            <p className="text-sm text-muted-foreground">
              Only users with <code>billing:manage</code> can open the Stripe
              portal.
            </p>
          }
        >
          <Button
            variant="secondary"
            onClick={() => void openBillingPortal()}
            disabled={createPortal.isPending}
          >
            {createPortal.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              // Names the destination, not the verb — §6.2 keeps
              // Lucide for control furniture, and the billing intent
              // is already a Signet duotone in `nav-glyphs.tsx`.
              // `AlertTriangle` above stays Lucide: it is the danger
              // marker `async-states.tsx` draws for the same tone, not
              // a domain intent.
              <BillingGlyph className="h-4 w-4" />
            )}
            Open Stripe billing portal
          </Button>
        </Can>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
          Chapter deactivation is a supported-by-Frapp action. Contact support
          from the billing portal. Data is preserved indefinitely in read-only
          mode (see privacy policy).
        </p>
      </CardContent>
    </Card>
  );
}
