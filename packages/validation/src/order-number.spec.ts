import { describe, expect, it } from "vitest";
import { MEMBER_ORDER_NUMBER_MAX } from "./field-limits";
import {
  ORDER_NUMBER_INVALID_MESSAGE,
  parseOrderNumber,
} from "./order-number";

describe("parseOrderNumber", () => {
  it("reads a whole number, and a blank as none", () => {
    expect(parseOrderNumber(" 12 ")).toBe(12);
    expect(parseOrderNumber("")).toBeNull();
    expect(parseOrderNumber("   ")).toBeNull();
    expect(parseOrderNumber(String(MEMBER_ORDER_NUMBER_MAX))).toBe(
      MEMBER_ORDER_NUMBER_MAX,
    );
  });

  it.each([
    "0",
    "-1",
    "1.5",
    "abc",
    "1e3",
    String(MEMBER_ORDER_NUMBER_MAX + 1),
  ])("refuses %s", (text) => {
    expect(parseOrderNumber(text)).toBeUndefined();
  });
});

describe("ORDER_NUMBER_INVALID_MESSAGE", () => {
  it("names the upper bound the parser enforces", () => {
    expect(ORDER_NUMBER_INVALID_MESSAGE).toBe(
      "A whole number from 1 to 1,000,000, or blank for none.",
    );
  });
});
