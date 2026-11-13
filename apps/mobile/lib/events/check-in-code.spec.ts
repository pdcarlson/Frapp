import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHECK_IN_TOKEN_WINDOW_MS, isPlausibleManualCode } from "./check-in-code";

describe("CHECK_IN_TOKEN_WINDOW_MS", () => {
  /**
   * Read from the API's source rather than restated, because s22 draws a code
   * as live only while it still redeems, and that bound is this window: if
   * the server's window shrank and this didn't, the host screen would draw
   * dead codes. Nothing in the type system connects the two workspaces.
   */
  it("is the window the API signs codes for", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../../../api/src/domain/utils/check-in-token.ts"),
      "utf8",
    );
    const match = /export const CHECK_IN_TOKEN_WINDOW_MS = ([\d_]+);/.exec(
      source,
    );
    expect(
      match,
      "CHECK_IN_TOKEN_WINDOW_MS not found in the API",
    ).not.toBeNull();
    expect(Number(match![1].replace(/_/g, ""))).toBe(CHECK_IN_TOKEN_WINDOW_MS);
  });
});

describe("isPlausibleManualCode", () => {
  it("accepts the drawn shape however it is punctuated", () => {
    expect(isPlausibleManualCode("4KQ-88")).toBe(true);
    expect(isPlausibleManualCode("4kq88")).toBe(true);
    expect(isPlausibleManualCode(" 4KQ 88 ")).toBe(true);
  });

  it("rejects lengths that cannot be a code", () => {
    expect(isPlausibleManualCode("")).toBe(false);
    expect(isPlausibleManualCode("4KQ")).toBe(false);
    expect(isPlausibleManualCode("4KQ-8888")).toBe(false);
  });
});
