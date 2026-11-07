import { describe, expect, it } from "vitest";
import { STATUS_LABELS, statusLabel } from "./status-labels";

describe("status labels", () => {
  it("never renders a token", () => {
    for (const vocabulary of Object.values(STATUS_LABELS)) {
      for (const label of Object.values(vocabulary)) {
        expect(label).not.toMatch(/[A-Z]{2,}|_/);
        expect(label).toMatch(/^[A-Z][a-z]/);
      }
    }
  });

  it("maps a known token and words an unknown one", () => {
    expect(statusLabel("serviceEntry", "APPROVED")).toBe("Approved");
    expect(statusLabel("task", "IN_PROGRESS")).toBe("In progress");
    expect(statusLabel("invoice", "UNCOLLECTIBLE")).toBe("Uncollectible");
    expect(statusLabel("studySession", "SOME_NEW_STATE")).toBe(
      "Some new state",
    );
  });
});
