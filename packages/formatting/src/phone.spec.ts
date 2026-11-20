import { describe, expect, it } from "vitest";
import { formatPhone, formatPhoneInput, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["5551234567", "+15551234567"],
    ["(555) 123 4567", "+15551234567"],
    ["555-123-4567", "+15551234567"],
    ["518.555.0142", "+15185550142"],
    ["1 518 555 0142", "+15185550142"],
    [" +1 518 555 0142 ", "+15185550142"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("stores %j as %j", (typed, stored) => {
    expect(normalizePhone(typed)).toBe(stored);
  });

  it("keeps a short local number as typed", () => {
    expect(normalizePhone(" 555-0142 ")).toBe("555-0142");
  });

  it("leaves letters and extensions for validation to refuse", () => {
    expect(normalizePhone("518-555-0142 ext 4")).toBe("518-555-0142 ext 4");
    expect(normalizePhone("call me")).toBe("call me");
  });
});

describe("formatPhone", () => {
  it.each([
    ["+15551234567", "(555) 123-4567"],
    ["5551234567", "(555) 123-4567"],
    ["555-123-4567", "(555) 123-4567"],
    ["(555) 123 4567", "(555) 123-4567"],
    ["+442079460958", "+44 20 7946 0958"],
    ["+44 20 7946 0958", "+44 20 7946 0958"],
  ])("shows %j as %j", (stored, shown) => {
    expect(formatPhone(stored)).toBe(shown);
  });

  it("shows what doesn't read as a whole number as it was stored", () => {
    expect(formatPhone(" 555-0142 ")).toBe("555-0142");
  });

  it("is empty for none", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone(undefined)).toBe("");
    expect(formatPhone("")).toBe("");
  });
});

/** Type `text` one character at a time, as a member would. */
function typeAll(text: string): string {
  let value = "";
  for (const char of text) {
    value = formatPhoneInput(value + char, value.length + 1, value).value;
  }
  return value;
}

describe("formatPhoneInput", () => {
  it("formats a US number as it is typed", () => {
    expect(typeAll("5551234567")).toBe("(555) 123-4567");
    expect(formatPhoneInput("5551234567").value).toBe("(555) 123-4567");
  });

  it("keeps a number starting with + in its country's format", () => {
    expect(typeAll("+442079460958")).toBe("+44 20 7946 0958");
    expect(formatPhoneInput("+44 20 7946 0958").value).toBe("+44 20 7946 0958");
  });

  it("puts the caret after the digit just typed", () => {
    // "(555) 12" with "3" typed at the end.
    expect(formatPhoneInput("(555) 123", 9, "(555) 12")).toEqual({
      value: "(555) 123",
      caret: 9,
    });
    // A digit typed in the middle keeps the caret right after it.
    expect(formatPhoneInput("(5595) 123-456", 4, "(555) 123-456")).toEqual({
      value: "(559) 512-3456",
      caret: 4,
    });
  });

  it("takes the digit before a separator a backspace removed", () => {
    expect(formatPhoneInput("(555", 4, "(555)")).toEqual({
      value: "55",
      caret: 2,
    });
    expect(formatPhoneInput("(555) 1234567", 9, "(555) 123-4567")).toEqual({
      value: "(555) 124-567",
      caret: 8,
    });
  });

  it("works out the caret from the text before, when none is given", () => {
    // A backspace over the "-" in the middle, as React Native reports it.
    expect(
      formatPhoneInput("(555) 1234567", undefined, "(555) 123-4567"),
    ).toEqual({ value: "(555) 124-567", caret: 8 });
    // A digit typed at the end.
    expect(formatPhoneInput("(555) 1234", undefined, "(555) 123")).toEqual({
      value: "(555) 123-4",
      caret: 11,
    });
  });

  it("clears to empty, and keeps a lone +", () => {
    expect(formatPhoneInput("", 0, "5")).toEqual({ value: "", caret: 0 });
    expect(formatPhoneInput("+", 1, "")).toEqual({ value: "+", caret: 1 });
  });

  it("drops letters and stops at 15 digits", () => {
    expect(formatPhoneInput("555a").value).toBe("(555)");
    expect(
      formatPhoneInput("+1234567890123456789").value.replace(/\D/g, ""),
    ).toHaveLength(15);
  });
});
