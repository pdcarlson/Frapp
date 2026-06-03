import { describe, it, expect } from "vitest";
import { normalizeRoleOptions } from "./roles";

describe("normalizeRoleOptions", () => {
  it("keeps well-formed roles and drops malformed entries", () => {
    expect(
      normalizeRoleOptions([
        { id: "r1", name: "Exec" },
        { id: 2, name: "Bad id" },
        { id: "r3" },
        null,
        "nope",
        { id: "r4", name: "Committee", extra: true },
      ]),
    ).toEqual([
      { id: "r1", name: "Exec" },
      { id: "r4", name: "Committee" },
    ]);
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeRoleOptions(undefined)).toEqual([]);
    expect(normalizeRoleOptions(null)).toEqual([]);
    expect(normalizeRoleOptions({})).toEqual([]);
  });
});
