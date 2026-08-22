import type { BadgeKind } from "@/components/ui/badge";

export type ServiceStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Service-entry review state → the §5 badge kind that states it.
 *
 * `service-page.tsx` had a `statusBadgeVariant()` switch mapping `APPROVED` to
 * `default` — the chapter accent — which is the defect #1202 names for
 * attendance and the Directory & Finance slice of #920 fixed for invoices.
 * `writing.md` §5: "status color is never decorative". The measurement behind
 * it is in `components.md` §5, pinned across all 19 seeds in
 * `../billing/status-contrast.test.ts`, and that this mapper never returns the
 * accent is pinned in `../shared/status-kind.test.ts`: an accent badge is 1.08:1 from the
 * success tint under a green-seeded chapter and 1.13:1 from the danger tint
 * under a red-seeded one, so a red-branded chapter read `APPROVED` as
 * `REJECTED` — the one column where that inversion costs a member their hours.
 *
 * `PENDING` moves off `secondary` in the same change, for the same reason
 * attendance's `LATE` does: `secondary` is §5's **Neutral** kind, "counts and
 * unread markers", so a status was rendering in the count badge. Pending is
 * foundations §5's own word for `--warning`, and it is the same mapping
 * `invoice-status.ts` gives `OPEN` — a thing that is not yet settled rather
 * than a thing that went wrong.
 *
 * There is no `default:` state to fall through to in practice — the union is
 * closed at three — but the arm is kept and returns §5's Hairline kind rather
 * than the accent, so a status added server-side renders as quiet metadata
 * instead of silently claiming the chapter's colour.
 */
export function serviceStatusKind(status: ServiceStatus): BadgeKind {
  switch (status) {
    case "APPROVED":
      return "success";
    case "PENDING":
      return "warning";
    case "REJECTED":
      return "destructive";
    default:
      return "outline";
  }
}
