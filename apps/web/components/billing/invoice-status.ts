import type { BadgeKind } from "@/components/ui/badge";

/**
 * Invoice and subscription state → the §5 badge kind that states it.
 *
 * One mapper because there were two, and they disagreed. `invoice-admin-card`
 * had a `statusVariant()` switch; `app/(dashboard)/billing/page.tsx` had an
 * inline ternary in the member-facing table. Both mapped `PAID` to `default` —
 * the **chapter accent** — which `writing.md` §5 rules out directly: "status
 * labels render with the semantic status colors … status color is never
 * decorative".
 *
 * That is measurable rather than stylistic. Across the seeded chapter
 * directory, an accent badge sits 1.08:1 from the success tint under a
 * green-accented chapter and 1.13:1 from the danger tint under a red-accented
 * one — so the chapter whose brand most needs `PAID` to read as paid is exactly
 * the chapter where it renders as overdue. Pinned in `status-contrast.test.ts`.
 *
 * `DRAFT` is the one state that is deliberately *not* semantic: it is the
 * absence of a status rather than a status, so it takes §5's Hairline kind,
 * "quiet metadata that must not read as a status".
 *
 * **There is no `OVERDUE` case, deliberately.** `financial_invoices.status` is
 * constrained to `DRAFT | OPEN | PAID | VOID`; overdue is a *derived* fact from
 * `GET /v1/invoices/overdue`, which is grace-aware in a way a client cannot be,
 * and it renders as its own badge beside the status rather than replacing it.
 * An earlier cut of this mapper carried an `OVERDUE` branch that could never be
 * reached.
 *
 * The parameter is `string` rather than that union because one of the two call
 * sites types its rows loosely and compares against `"OVERDUE"` — the dead
 * comparison #1196 is about. Tightening this signature is the right end state
 * and will surface that bug as a compile error; it is #1196's to do, not a
 * repaint's.
 */
export function invoiceStatusKind(status: string): BadgeKind {
  switch (status) {
    case "PAID":
      return "success";
    case "OPEN":
      return "warning";
    case "VOID":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Chapter subscription state → the same kinds.
 *
 * All three non-active states lock paid operations — `subscriptionWriteState`
 * returns `REQUIRED` for `incomplete` just as it returns `CANCELED` and
 * `WRITE_LOCKED` for the other two — so the tone here is not reporting *whether*
 * writes are blocked. The `SubscriptionNotice` on each gated control does that.
 * What it reports is which kind of problem this is, and they are different
 * kinds: `past_due` and `canceled` are a working subscription that regressed,
 * which is the failure §5 gives danger to. `incomplete` is one that never
 * started — foundations §5's "pending", and the one state the chapter can
 * resolve itself without leaving the page, since `spec/ui/web-dashboard`'s
 * contract offers checkout only there. Painting a brand-new chapter's unstarted
 * setup in danger red would be the decorative use of a semantic hue §5 forbids.
 */
export function subscriptionStatusKind(
  status: string | null | undefined,
): BadgeKind {
  switch (status) {
    case "active":
      return "success";
    case "incomplete":
      return "warning";
    case "past_due":
    case "canceled":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * The subscription state as a person should read it.
 *
 * Stripe's tokens are snake_case, and CSS `capitalize` does not treat `_` as a
 * word boundary — so `past_due` under a `capitalize` class rendered as
 * "Past_due". `writing.md` §5 fixes the vocabulary for the states it names;
 * these are Stripe's own and have no §5 row, so they map to the plain-language
 * equivalent once, here, rather than being re-cased at each call site.
 */
export function subscriptionStatusLabel(
  status: string | null | undefined,
): string {
  switch (status) {
    case "active":
      return "Active";
    case "incomplete":
      return "Incomplete";
    case "past_due":
      return "Past due";
    case "canceled":
      return "Canceled";
    default:
      return "Unknown";
  }
}
