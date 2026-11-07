import { describe, expect, it } from "vitest";
import {
  channelsRoleRefusalBody,
  isRoleRefusal,
} from "./channels-refused-copy";

function httpError(status: number, code?: string): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    status,
    ...(code ? { code } : {}),
  });
}

describe("isRoleRefusal", () => {
  it("is a 403 from the permissions check, which carries no code", () => {
    expect(isRoleRefusal(httpError(403))).toBe(true);
  });

  it("is not the chapter guard's 403s, which no role fixes", () => {
    expect(isRoleRefusal(httpError(403, "chapter.context.mismatch"))).toBe(
      false,
    );
    expect(isRoleRefusal(httpError(403, "chapter.context.invalid"))).toBe(
      false,
    );
  });

  it("is not any other failure", () => {
    expect(isRoleRefusal(httpError(500))).toBe(false);
    expect(isRoleRefusal(httpError(401))).toBe(false);
    expect(isRoleRefusal(new Error("fetch failed"))).toBe(false);
  });
});

describe("channelsRoleRefusalBody", () => {
  it("names the chapter, or says this chapter before it loads", () => {
    expect(channelsRoleRefusalBody("Phi Gamma Delta")).toBe(
      "Your role in Phi Gamma Delta doesn't include chat. Ask an officer to give you the Member role.",
    );
    expect(channelsRoleRefusalBody(null)).toContain(
      "Your role in this chapter",
    );
  });
});
