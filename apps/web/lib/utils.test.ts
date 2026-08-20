import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./utils";

/**
 * Dashboard toasts use this helper so openapi-fetch's thrown body (a plain
 * object with `message`, not an `Error`) surfaces the server string. Five
 * local copies used `instanceof Error` and always showed the fallback; this
 * spec is the regression lock for that shape.
 */
describe("getErrorMessage", () => {
  const fallback = "Something went wrong. Please retry.";

  it("reads a string message on a plain object (openapi-fetch body)", () => {
    expect(
      getErrorMessage({ message: "Role is already assigned.", statusCode: 409 }, fallback),
    ).toBe("Role is already assigned.");
  });

  it("still reads Error instances", () => {
    expect(getErrorMessage(new Error("network down"), fallback)).toBe("network down");
  });

  it("uses the caller fallback when message is missing, empty, or not a string", () => {
    expect(getErrorMessage(null, fallback)).toBe(fallback);
    expect(getErrorMessage(undefined, fallback)).toBe(fallback);
    expect(getErrorMessage("nope", fallback)).toBe(fallback);
    expect(getErrorMessage({}, fallback)).toBe(fallback);
    expect(getErrorMessage({ message: "" }, fallback)).toBe(fallback);
    expect(
      getErrorMessage({ message: ["lat must be a number", "lng too"] }, fallback),
    ).toBe(fallback);
  });
});
