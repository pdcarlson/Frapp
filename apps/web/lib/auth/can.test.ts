import { describe, expect, test } from "vitest";
import { can, canAll, canAny, WILDCARD_PERMISSION } from "./can";

describe("can", () => {
  test("returns false for undefined, null, or empty permission sets", () => {
    expect(can("members:view", undefined)).toBe(false);
    expect(can("members:view", null)).toBe(false);
    expect(can("members:view", [])).toBe(false);
  });

  test("wildcard short-circuits to true", () => {
    expect(can("anything:you:want", [WILDCARD_PERMISSION])).toBe(true);
    expect(can("anything:you:want", ["members:view", WILDCARD_PERMISSION])).toBe(
      true,
    );
  });

  test("returns true for exact permission match", () => {
    expect(can("events:create", ["events:create", "members:view"])).toBe(true);
  });

  test("returns false when required permission is absent", () => {
    expect(can("billing:manage", ["members:view"])).toBe(false);
  });
});

describe("canAll", () => {
  test("empty required list grants access", () => {
    expect(canAll([], undefined)).toBe(true);
    expect(canAll([], [])).toBe(true);
  });

  test("returns false when permission set is missing", () => {
    expect(canAll(["members:view"], undefined)).toBe(false);
    expect(canAll(["members:view"], [])).toBe(false);
  });

  test("wildcard satisfies any set of requirements", () => {
    expect(canAll(["members:invite", "roles:manage"], [WILDCARD_PERMISSION])).toBe(
      true,
    );
  });

  test("requires every listed permission", () => {
    expect(
      canAll(["members:view", "events:create"], ["members:view", "events:create"]),
    ).toBe(true);
    expect(
      canAll(["members:view", "events:create"], ["members:view"]),
    ).toBe(false);
  });
});

describe("canAny", () => {
  test("empty required list denies access (no grant claimed)", () => {
    expect(canAny([], [WILDCARD_PERMISSION])).toBe(false);
    expect(canAny([], ["members:view"])).toBe(false);
  });

  test("returns false when permission set is missing", () => {
    expect(canAny(["members:view"], undefined)).toBe(false);
    expect(canAny(["members:view"], [])).toBe(false);
  });

  test("wildcard grants any", () => {
    expect(canAny(["reports:export"], [WILDCARD_PERMISSION])).toBe(true);
  });

  test("grants access when at least one permission matches", () => {
    expect(
      canAny(["members:invite", "roles:manage"], ["members:invite"]),
    ).toBe(true);
    expect(
      canAny(["members:invite", "roles:manage"], ["events:create"]),
    ).toBe(false);
  });
});
