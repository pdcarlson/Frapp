import { BillingRedirect } from "@/components/billing/billing-redirect";

/**
 * Billing has no page of its own any more: it is Plan and billing in Chapter
 * settings, and a member's invoices are My invoices in Settings (#3827). Old
 * links, bookmarks, notifications and in-flight Stripe returns still name
 * this route, so it forwards by what the viewer holds.
 */
export default function Billing() {
  return <BillingRedirect />;
}
