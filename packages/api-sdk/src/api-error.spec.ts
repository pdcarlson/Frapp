import { describe, expect, it } from "vitest";
import { codeOf, serverMessageOf, statusOf } from "./api-error";
import type { ApiErrorBody } from "./api-error";

describe("statusOf", () => {
  it("prefers statusCode over status", () => {
    expect(statusOf({ statusCode: 409, status: 400 })).toBe(409);
  });

  it("reads status when statusCode is absent", () => {
    expect(statusOf({ status: 403 })).toBe(403);
  });

  it("returns undefined for missing, non-number, or null input", () => {
    expect(statusOf({})).toBeUndefined();
    expect(statusOf({ statusCode: "409" })).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
    expect(statusOf(undefined)).toBeUndefined();
  });
});

describe("serverMessageOf", () => {
  it("returns a non-empty string message", () => {
    expect(serverMessageOf({ message: "Geofence missed" })).toBe(
      "Geofence missed",
    );
  });

  it("joins a validation-pipe message array", () => {
    expect(
      serverMessageOf({ message: ["lat must be a number", "lng too"] }),
    ).toBe("lat must be a number, lng too");
  });

  it("treats empty string, empty array, and missing message as absent", () => {
    expect(serverMessageOf({ message: "" })).toBeNull();
    expect(serverMessageOf({ message: [] })).toBeNull();
    expect(serverMessageOf({})).toBeNull();
    expect(serverMessageOf(null)).toBeNull();
  });
});

describe("codeOf", () => {
  it("returns a non-empty structured code", () => {
    expect(codeOf({ code: "chapter.module.disabled" })).toBe(
      "chapter.module.disabled",
    );
  });

  it("reads the code off a body shaped like the API's error schema", () => {
    // One real body with a code and one without. The annotations are for the
    // reader: this file is outside the package's `tsc` program (its tsconfig
    // excludes specs), so the compile-time tie to the schema is `ApiErrorShape`
    // in `api-error.ts`, not these literals.
    const refused: ApiErrorBody = {
      statusCode: 403,
      error: "FORBIDDEN",
      message: "You are not a member of the requested chapter.",
      requestId: "req_1",
      code: "chapter.context.invalid",
    };
    const codeless: ApiErrorBody = {
      statusCode: 404,
      error: "NOT_FOUND",
      message: "Chapter not found",
      requestId: "req_2",
    };

    expect(codeOf(refused)).toBe("chapter.context.invalid");
    expect(statusOf(refused)).toBe(403);
    expect(codeOf(codeless)).toBeNull();
  });

  it("treats empty string, non-string, and missing code as absent", () => {
    expect(codeOf({ code: "" })).toBeNull();
    expect(codeOf({ code: 403 })).toBeNull();
    expect(codeOf({})).toBeNull();
    expect(codeOf(null)).toBeNull();
  });
});
