import { describe, expect, it } from "vitest";
import { AI_REPORT_REASONS } from "./ai-report";
import {
  ASK_FEEDBACK_COPY,
  ASK_FEEDBACK_REASONS,
  ASK_SIGNALS,
  AskFeedbackRequestSchema,
  AskSignalRequestSchema,
  askFeedbackReasonLabel,
  askFeedbackReportReason,
} from "./ask-feedback";

describe("AskFeedbackRequestSchema", () => {
  it("takes a thumbs up, a thumbs down, and a down with a reason", () => {
    expect(AskFeedbackRequestSchema.safeParse({ rating: "up" }).success).toBe(
      true,
    );
    expect(AskFeedbackRequestSchema.safeParse({ rating: "down" }).success).toBe(
      true,
    );
    for (const reason of ASK_FEEDBACK_REASONS) {
      expect(
        AskFeedbackRequestSchema.safeParse({ rating: "down", reason }).success,
      ).toBe(true);
    }
  });

  it("refuses a reason on a thumbs up, and a reason that is not on the list", () => {
    expect(
      AskFeedbackRequestSchema.safeParse({ rating: "up", reason: "wrong" })
        .success,
    ).toBe(false);
    expect(
      AskFeedbackRequestSchema.safeParse({
        rating: "down",
        reason: "It told me the wrong date",
      }).success,
    ).toBe(false);
  });

  it("has no field for words: anything else sent is dropped", () => {
    const parsed = AskFeedbackRequestSchema.parse({
      rating: "down",
      reason: "other",
      note: "It told me the wrong date",
    });
    expect(parsed).toEqual({ rating: "down", reason: "other" });
  });
});

describe("AskSignalRequestSchema", () => {
  it("takes each signal and nothing else", () => {
    for (const signal of ASK_SIGNALS) {
      expect(AskSignalRequestSchema.safeParse({ signal }).success).toBe(true);
    }
    expect(AskSignalRequestSchema.safeParse({ signal: "liked" }).success).toBe(
      false,
    );
  });
});

describe("the words", () => {
  it("has a label for every reason, and a fallback for one it does not know", () => {
    for (const reason of ASK_FEEDBACK_REASONS) {
      expect(askFeedbackReasonLabel(reason)).toBe(
        ASK_FEEDBACK_COPY.reasons[reason],
      );
    }
    expect(askFeedbackReasonLabel("newer")).toBe(
      ASK_FEEDBACK_COPY.reasons.other,
    );
  });

  it("starts Report this on a reason that list has", () => {
    for (const reason of [...ASK_FEEDBACK_REASONS, null, undefined, "newer"]) {
      expect(AI_REPORT_REASONS).toContain(askFeedbackReportReason(reason));
    }
    expect(askFeedbackReportReason("wrong")).toBe("wrong");
    expect(askFeedbackReportReason("too_long")).toBe("other");
  });
});
