import type { ReactNode } from "react";

export const metadata = {
  title: "Billing | Frapp",
  description: "Chapter billing, invoices, and Stripe subscription status.",
};

export default function BillingLayout({ children }: { children: ReactNode }) {
  return children;
}
