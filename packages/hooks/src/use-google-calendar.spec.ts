import { describe, expect, it } from "vitest";
import { readGoogleCalendarReturn } from "./use-google-calendar";

const read = (query: string) =>
  readGoogleCalendarReturn(new URLSearchParams(query));

describe("readGoogleCalendarReturn", () => {
  it("reads a sign-in to finish, with its code and state", () => {
    expect(read("gcal=confirm&gcal_code=c1&gcal_state=s1")).toEqual({
      kind: "confirm",
      code: "c1",
      state: "s1",
    });
  });

  it("reads a cancel and an expired sign-in", () => {
    expect(read("gcal=denied")).toEqual({ kind: "denied" });
    expect(read("gcal=expired")).toEqual({ kind: "expired" });
  });

  it("reads a confirm missing its code, or anything unknown, as failed", () => {
    expect(read("gcal=confirm&gcal_state=s1")).toEqual({ kind: "failed" });
    expect(read("gcal=weird")).toEqual({ kind: "failed" });
  });

  it("reads nothing when the URL carries no return", () => {
    expect(read("event=1")).toBeNull();
  });
});
