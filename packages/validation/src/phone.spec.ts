import { describe, expect, it } from "vitest";
import { isPhoneNumber, phoneDialString, phoneHref } from "./phone";

describe("isPhoneNumber", () => {
  it.each([
    "(518) 555-0142",
    "518-555-0142",
    "518.555.0142",
    "+1 518 555 0142",
    "+44 20 7946 0958",
    "5185550142",
    "  518 555 0142  ",
  ])("accepts %s", (value) => {
    expect(isPhoneNumber(value)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "555-01",
    "call me",
    "518-555-0142 ext 4",
    "++1 518 555 0142",
    "1+518 555 0142",
    "1234567890123456",
    "1 ".repeat(17),
  ])("refuses %j", (value) => {
    expect(isPhoneNumber(value)).toBe(false);
  });
});

describe("phoneDialString and phoneHref", () => {
  it("keeps the digits and a leading plus", () => {
    expect(phoneDialString("(518) 555-0142")).toBe("5185550142");
    expect(phoneDialString(" +1 518 555 0142")).toBe("+15185550142");
  });

  it("has nothing to dial without digits", () => {
    expect(phoneDialString(null)).toBeNull();
    expect(phoneDialString("")).toBeNull();
    expect(phoneHref("()", "call")).toBeNull();
  });

  it("builds tel and sms links", () => {
    expect(phoneHref("(518) 555-0142", "call")).toBe("tel:5185550142");
    expect(phoneHref("+1 518 555 0142", "text")).toBe("sms:+15185550142");
  });
});
