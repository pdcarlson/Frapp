import { describe, expect, it } from "vitest";
import { isCardReadMiss } from "./card-read-miss";

const refusal = (statusCode: number, code?: string) => ({
  statusCode,
  message: "No",
  ...(code ? { code } : {}),
});

describe("isCardReadMiss", () => {
  it("reads a 404, and a 403 from the route's own checks, as an answer", () => {
    expect(isCardReadMiss(refusal(404))).toBe(true);
    // A missing permission, and the module guard's coded refusal.
    expect(isCardReadMiss(refusal(403))).toBe(true);
    expect(isCardReadMiss(refusal(403, "chapter.module.disabled"))).toBe(true);
  });

  it("leaves ChapterGuard's chapter-context 403s to throw: they clear by themselves", () => {
    expect(isCardReadMiss(refusal(403, "chapter.context.mismatch"))).toBe(false);
    expect(isCardReadMiss(refusal(403, "chapter.context.invalid"))).toBe(false);
  });

  it("leaves every other failure to throw", () => {
    expect(isCardReadMiss(refusal(500))).toBe(false);
    expect(isCardReadMiss(refusal(400, "chapter.context.required"))).toBe(false);
    expect(isCardReadMiss(new Error("Network request failed"))).toBe(false);
  });
});
