import type { BadgeProps } from "@/components/ui/badge";

type BadgeKind = NonNullable<BadgeProps["variant"]>;

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
 */
export function invoiceStatusKind(status: string): BadgeKind {
  switch (status) {
    case "PAID":
      return "success";
    case "OPEN":
      return "warning";
    case "OVERDUE":
    case "VOID":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Chapter subscription state → the same kinds.
 *
 * `past_due` and `canceled` are both danger: they are the two states that lock
 * paid operations, and `spec/ui/design-system/README.md` §5 makes the whole
 * screen's job recovering from them.
 */
export function subscriptionStatusKind(status: string | null | undefined): BadgeKind {
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
