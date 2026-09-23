import { describe, expect, test } from "vitest";

/**
 * Moved here from `apps/web/lib/auth/can.test.ts` with #994, travelling with the
 * implementation when it became shared with apps/mobile. Unchanged otherwise —
 * an unmodified suite passing against the moved code is the no-regression proof
 * for the move.
 */
import {
  can,
  canAll,
  canAny,
  CHAT_REPORT_QUEUE_PERMISSIONS,
  WILDCARD_PERMISSION,
} from "./permissions";

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

describe("CHAT_REPORT_QUEUE_PERMISSIONS", () => {
  // The API side of the same list is pinned in chat-report.controller.spec.ts,
  // against the route decorators themselves.
  test("admits a holder of both halves, or the wildcard, and nobody holding one", () => {
    expect(
      canAll(CHAT_REPORT_QUEUE_PERMISSIONS, ["members:view", "channels:manage"]),
    ).toBe(true);
    expect(canAll(CHAT_REPORT_QUEUE_PERMISSIONS, [WILDCARD_PERMISSION])).toBe(true);
    expect(canAll(CHAT_REPORT_QUEUE_PERMISSIONS, ["channels:manage"])).toBe(false);
    expect(canAll(CHAT_REPORT_QUEUE_PERMISSIONS, ["members:view"])).toBe(false);
  });
});
