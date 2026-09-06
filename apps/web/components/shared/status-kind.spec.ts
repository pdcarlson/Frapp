import { describe, expect, it } from "vitest";
import {
  attendanceStatusKind,
  attendanceStatusLabel,
} from "@/components/events/attendance-status";
import { serviceStatusKind } from "@/components/service/service-status";
import { studySessionStatusKind } from "@/components/study/study-status";
import { geofenceStatusKind } from "@/components/geofences/geofence-status";
import {
  pollStatusKind,
  pollStatusLabel,
} from "@/components/polls/poll-status";
import {
  invoiceStatusKind,
  subscriptionStatusKind,
} from "@/components/billing/invoice-status";
import {
  moduleTierKind,
  moduleTierLabel,
} from "@/components/settings/settings-status";

/**
 * The defect this file exists for.
 *
 * #1202 reported one accent-painted status badge. Chapter Ops had five, in
 * four files and three spellings, and every one of them read fine as a class
 * name — `variant="default"` says nothing about the chapter accent unless you
 * know `default` is §5's Accent kind.
 *
 * One shared file rather than one per family, because the invariant is shared:
 * **no domain status is ever the chapter accent.** The measurement behind that
 * rule is already pinned across all 19 seeds in
 * `components/billing/status-contrast.spec.ts` and is deliberately not
 * restated here; what this adds is that every mapper obeys it, including the
 * ones a later slice adds.
 */

const MAPPERS = {
  attendance: {
    fn: attendanceStatusKind,
    inputs: ["PRESENT", "LATE", "ABSENT", "EXCUSED", "UNRECORDED"],
  },
  service: {
    fn: serviceStatusKind,
    inputs: ["APPROVED", "PENDING", "REJECTED"],
  },
  study: {
    fn: studySessionStatusKind,
    inputs: [
      "ACTIVE",
      "COMPLETED",
      "PAUSED_EXPIRED",
      "EXPIRED",
      "LOCATION_INVALID",
    ],
  },
  invoice: { fn: invoiceStatusKind, inputs: ["PAID", "OPEN", "VOID", "DRAFT"] },
  subscription: {
    fn: subscriptionStatusKind,
    inputs: ["active", "incomplete", "past_due", "canceled"],
  },
  moduleTier: { fn: moduleTierKind, inputs: ["free", "paid"] },
} as const;

/**
 * Mappers whose input is a derived boolean rather than a server status
 * token, so they cannot join the table above. They are held to the same two
 * invariants that can apply — never the accent, never Neutral. The third
 * (an unmapped status falls back to Hairline) has no meaning for a boolean:
 * there is no unmapped third value for the server to add.
 */
const BOOLEAN_MAPPERS: Record<string, (value: boolean) => string> = {
  geofence: geofenceStatusKind,
  poll: pollStatusKind,
};

describe("status colour is never the chapter accent", () => {
  it("would have caught PRESENT, APPROVED, COMPLETED and Active painted in it", () => {
    for (const [family, { fn, inputs }] of Object.entries(MAPPERS)) {
      for (const status of inputs) {
        expect(
          (fn as (s: string) => string)(status),
          `${family}: ${status}`,
        ).not.toBe("default");
      }
    }
    for (const [family, fn] of Object.entries(BOOLEAN_MAPPERS)) {
      expect(fn(true), `${family}: true`).not.toBe("default");
      expect(fn(false), `${family}: false`).not.toBe("default");
    }
  });

  it("never falls back to the accent for a status the server adds later", () => {
    // The `default:` arm is §5's Hairline kind in every mapper, so a status
    // nobody has mapped yet renders as quiet metadata rather than silently
    // claiming the chapter's colour.
    for (const [family, { fn }] of Object.entries(MAPPERS)) {
      expect(
        (fn as (s: string) => string)("SOMETHING_NEW"),
        `${family} fallback`,
      ).toBe("outline");
    }
  });

  it("keeps status off §5's Neutral kind, which is for counts", () => {
    // `secondary` was carrying LATE, PENDING and ACTIVE — a status rendered in
    // the count badge. §5 reserves Neutral for "counts and unread markers".
    for (const [family, { fn, inputs }] of Object.entries(MAPPERS)) {
      for (const status of inputs) {
        expect(
          (fn as (s: string) => string)(status),
          `${family}: ${status}`,
        ).not.toBe("secondary");
      }
    }
    for (const [family, fn] of Object.entries(BOOLEAN_MAPPERS)) {
      expect(fn(true), `${family}: true`).not.toBe("secondary");
      expect(fn(false), `${family}: false`).not.toBe("secondary");
    }
  });
});

describe("the mappings themselves", () => {
  it("gives attendance the fact each status states", () => {
    expect(attendanceStatusKind("PRESENT")).toBe("success");
    expect(attendanceStatusKind("LATE")).toBe("warning");
    expect(attendanceStatusKind("ABSENT")).toBe("destructive");
    // Not a status: a member who owed no attendance, and a row the roster
    // synthesised. §5's Hairline, for `DRAFT`'s reason.
    expect(attendanceStatusKind("EXCUSED")).toBe("outline");
    expect(attendanceStatusKind("UNRECORDED")).toBe("outline");
  });

  it("moves attendance labels without rewriting them", () => {
    // A repaint must not quietly change user-visible copy; these are the
    // strings `STATUS_LABELS` and the UNRECORDED ternary already shipped.
    expect(attendanceStatusLabel("PRESENT")).toBe("Present");
    expect(attendanceStatusLabel("UNRECORDED")).toBe("Unrecorded");
  });

  it("splits study sessions the way writing.md §7 already does", () => {
    // "A close that awards points (COMPLETED, PAUSED_EXPIRED) must never read
    // as a loss, and one that awards nothing (EXPIRED, LOCATION_INVALID) must
    // say so." Danger belongs to exactly those two.
    expect(studySessionStatusKind("COMPLETED")).toBe("success");
    expect(studySessionStatusKind("PAUSED_EXPIRED")).not.toBe("destructive");
    expect(studySessionStatusKind("EXPIRED")).toBe("destructive");
    expect(studySessionStatusKind("LOCATION_INVALID")).toBe("destructive");
  });

  it("gives service review the same three kinds as invoice state", () => {
    expect(serviceStatusKind("APPROVED")).toBe(invoiceStatusKind("PAID"));
    expect(serviceStatusKind("PENDING")).toBe(invoiceStatusKind("OPEN"));
    expect(serviceStatusKind("REJECTED")).toBe("destructive");
  });

  it("treats a disabled study zone as the absence of a status, not a failure", () => {
    expect(geofenceStatusKind(true)).toBe("success");
    expect(geofenceStatusKind(false)).toBe("outline");
  });

  it("keeps a module's price tag out of the status channel entirely", () => {
    // Both tiers are Hairline, which is the finding rather than a compromise:
    // a tier is a fixed property of the module, the same for every chapter,
    // and the module's actual state is the Switch beside it. The tab painted
    // `Chapter Pro` in the chapter accent and `Free` in a hand-spelled success
    // tint, so a green badge next to an off switch said the module was on.
    expect(moduleTierKind("free")).toBe("outline");
    expect(moduleTierKind("paid")).toBe("outline");
  });

  it("keeps the tier labels the modules tab already shipped", () => {
    // `paid` is "Chapter Pro", not "Paid": §5 fixes `PAID` to mean a settled
    // invoice, and the same word on a module states the opposite.
    expect(moduleTierLabel("free")).toBe("Free");
    expect(moduleTierLabel("paid")).toBe("Chapter Pro");
  });

  it("reads a closed poll the same way — an end, not a failure", () => {
    // `spec/behavior/polls.md`: a poll past its deadline "is locked". That is
    // the expected end of a poll's life, so it takes Hairline rather than a
    // semantic hue, exactly as a switched-off zone and a `DRAFT` invoice do.
    expect(pollStatusKind(true)).toBe("success");
    expect(pollStatusKind(false)).toBe("outline");
  });

  it("keeps the poll labels the page already shipped", () => {
    // A repaint must not quietly change user-visible copy. These are the two
    // strings `polls-page.tsx` rendered from its inline ternary.
    expect(pollStatusLabel(true)).toBe("Open");
    expect(pollStatusLabel(false)).toBe("Closed");
  });
});
