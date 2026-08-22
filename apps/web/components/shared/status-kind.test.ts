import { describe, expect, it } from "vitest";
import {
  attendanceStatusKind,
  attendanceStatusLabel,
} from "@/components/events/attendance-status";
import { serviceStatusKind } from "@/components/service/service-status";
import { studySessionStatusKind } from "@/components/study/study-status";
import { geofenceStatusKind } from "@/components/geofences/geofence-status";
import {
  invoiceStatusKind,
  subscriptionStatusKind,
} from "@/components/billing/invoice-status";

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
 * `components/billing/status-contrast.test.ts` and is deliberately not
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
} as const;

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
    expect(geofenceStatusKind(true)).not.toBe("default");
    expect(geofenceStatusKind(false)).not.toBe("default");
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
});
