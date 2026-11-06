import { describe, expect, it } from "vitest";
import { LOAD_FAILURE_COPY, describeLoadFailure } from "./load-failure";

describe("describeLoadFailure", () => {
  it("names the connection when no response came back", () => {
    expect(describeLoadFailure(new TypeError("Failed to fetch"))).toBe(
      LOAD_FAILURE_COPY.offline,
    );
  });

  it("names access, not the connection, for a 403", () => {
    expect(
      describeLoadFailure({ statusCode: 403, message: "nope" }),
    ).toBe(LOAD_FAILURE_COPY.forbidden);
    expect(describeLoadFailure({ status: 403 })).toBe(LOAD_FAILURE_COPY.forbidden);
  });

  it("names the session for a 401 and the server for anything else", () => {
    expect(describeLoadFailure({ statusCode: 401 })).toBe(
      LOAD_FAILURE_COPY.signedOut,
    );
    expect(describeLoadFailure({ statusCode: 500 })).toBe(LOAD_FAILURE_COPY.server);
    expect(describeLoadFailure({ statusCode: 404 })).toBe(LOAD_FAILURE_COPY.server);
  });
});
