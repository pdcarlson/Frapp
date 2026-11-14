import { describe, expect, it } from "vitest";
import { askOffersThinkHarder } from "./ask-effort";

describe("askOffersThinkHarder", () => {
  it("is offered on a traced answer or a traced miss", () => {
    expect(askOffersThinkHarder({ status: "answered", ask_id: "a" }, null)).toBe(true);
    expect(askOffersThinkHarder({ status: "not_found", ask_id: "a" }, "default")).toBe(true);
  });

  it("is not offered twice, without a trace, or on a refusal", () => {
    expect(askOffersThinkHarder({ status: "answered", ask_id: "a" }, "more")).toBe(false);
    expect(askOffersThinkHarder({ status: "answered" }, null)).toBe(false);
    expect(askOffersThinkHarder({ status: "refused", ask_id: "a" }, null)).toBe(false);
    expect(askOffersThinkHarder({ status: "unavailable", ask_id: "a" }, null)).toBe(false);
  });
});
