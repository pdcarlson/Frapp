import { describe, expect, it } from "vitest";
import { isCardReadMiss } from "./card-read-miss";

const refusal = (statusCode: number, code?: string) => ({
  statusCode,
  message: "No",
  ...(code ? { code } : {}),
});

describe("isCardReadMiss", () => {
  it("reads a 404, and a 403 a retry won't change, as an answer", () => {
    expect(isCardReadMiss(refusal(404))).toBe(true);
    // A missing permission, the module guard's coded refusal, and a viewer
    // who is no longer in the chapter.
    expect(isCardReadMiss(refusal(403))).toBe(true);
    expect(isCardReadMiss(refusal(403, "chapter.module.disabled"))).toBe(true);
    expect(isCardReadMiss(refusal(403, "chapter.context.invalid"))).toBe(true);
  });

  it("leaves a chapter-context mismatch to throw: it clears once the token catches up", () => {
    expect(isCardReadMiss(refusal(403, "chapter.context.mismatch"))).toBe(
      false,
    );
  });

  it("leaves every other failure to throw", () => {
    expect(isCardReadMiss(refusal(500))).toBe(false);
    expect(isCardReadMiss(refusal(400, "chapter.context.required"))).toBe(
      false,
    );
    expect(isCardReadMiss(new Error("Network request failed"))).toBe(false);
  });
});
