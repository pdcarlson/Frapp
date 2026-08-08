/**
 * Format an integer cent amount as USD.
 *
 * Invoice amounts are stored and transported in cents (`financial_invoices.amount`),
 * so every billing surface needs the same cents → "$150.00" conversion. Kept in
 * one place because the billing page, the admin card, and the payment sheet had
 * each grown their own byte-identical copy — three chances to diverge later.
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
