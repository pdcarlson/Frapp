import { describe, expect, it, vi, beforeEach } from "vitest";
import { downloadBlob, getErrorMessage } from "./utils";

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

describe("downloadBlob", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("creates an object URL, clicks a download anchor, and revokes it", () => {
    const blob = new Blob(["content"], { type: "text/plain" });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(blob, "report.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="report.csv"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });

  // The reviewer finding this regression-locks: an unguarded click that
  // throws must still remove the anchor and revoke the object URL, or both
  // leak on every failed download.
  it("still removes the anchor and revokes the object URL when click() throws", () => {
    const blob = new Blob(["content"], { type: "text/plain" });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("blocked by extension");
      });

    expect(() => downloadBlob(blob, "report.csv")).toThrow("blocked by extension");

    expect(document.querySelector('a[download="report.csv"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });
});
