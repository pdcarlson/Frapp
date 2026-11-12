import { describe, expect, it } from "vitest";
import { MEMBER_ORDER_NUMBER_MAX } from "./field-limits";
import { parseOrderNumber } from "./order-number";

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
