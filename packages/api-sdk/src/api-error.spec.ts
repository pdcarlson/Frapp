import { describe, expect, it } from "vitest";
import {
  codeOf,
  isDefinitiveClientError,
  serverMessageOf,
  statusOf,
  throwUnlessOk,
} from "./api-error";
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

describe("throwUnlessOk", () => {
  const failed = (status: number) => ({ ok: false, status });

  function thrown(result: Parameters<typeof throwUnlessOk>[0]): unknown {
    try {
      throwUnlessOk(result);
    } catch (error) {
      return error;
    }
    return "did not throw";
  }

  it("passes a 2xx through, whatever the body", () => {
    expect(
      thrown({ error: undefined, response: { ok: true, status: 201 } }),
    ).toBe("did not throw");
  });

  // openapi-fetch's two shapes for an empty error body, both falsy.
  it.each([undefined, ""])("throws an empty error body (%j) with its status", (error) => {
    expect(statusOf(thrown({ error, response: failed(504) }))).toBe(504);
  });

  it("keeps a Nest body as it is", () => {
    const body = { statusCode: 403, message: "Forbidden", error: "Forbidden" };
    expect(thrown({ error: body, response: failed(403) })).toBe(body);
  });

  it("stamps the response status on an object body that names none", () => {
    // An edge's JSON refusal, not Nest's shape.
    const error = thrown({ error: { message: "Forbidden" }, response: failed(403) });
    expect(statusOf(error)).toBe(403);
    expect(serverMessageOf(error)).toBe("Forbidden");
  });

  it("keeps a plain-text body as the message", () => {
    const error = thrown({ error: "Bad Gateway", response: failed(502) });
    expect(statusOf(error)).toBe(502);
    expect(serverMessageOf(error)).toBe("Bad Gateway");
  });

  it("drops an HTML error page, so a toast never renders markup", () => {
    const error = thrown({
      error: "\n<!DOCTYPE html><html>403</html>",
      response: failed(403),
    });
    expect(statusOf(error)).toBe(403);
    expect(serverMessageOf(error)).toBeNull();
  });
});

describe("isDefinitiveClientError", () => {
  it("counts an origin's 4xx as definitive", () => {
    expect(isDefinitiveClientError(400)).toBe(true);
    expect(isDefinitiveClientError(409)).toBe(true);
    expect(isDefinitiveClientError(429)).toBe(true);
  });

  it("leaves out what an intermediary emits after a possible commit", () => {
    for (const status of [408, 499, 460]) {
      expect(isDefinitiveClientError(status)).toBe(false);
    }
  });

  it("is false outside the 4xx band", () => {
    expect(isDefinitiveClientError(500)).toBe(false);
    expect(isDefinitiveClientError(201)).toBe(false);
  });
});
