import { describe, expect, it } from "vitest";
import {
  NOT_SELF_ASSIGNABLE_CODE,
  selfAssignableRefusal,
} from "./self-assignable-roles";
import { refusalCopy } from "./error-copy";

describe("selfAssignableRefusal (#4958)", () => {
  const safe = { system_key: null, tier_id: null, permissions: [] };

  it("passes a role outside the tiers that holds nothing", () => {
    expect(selfAssignableRefusal(safe)).toBeNull();
  });

  it("passes channels:read:<slug> keys and nothing else", () => {
    expect(
      selfAssignableRefusal({ ...safe, permissions: ["channels:read:study"] }),
    ).toBeNull();
    expect(
      selfAssignableRefusal({
        ...safe,
        permissions: ["channels:read:study", "members:view"],
      }),
    ).toBe("role.self_assignable_permissions");
    expect(
      selfAssignableRefusal({ ...safe, permissions: ["channels:read:"] }),
    ).toBe("role.self_assignable_permissions");
    expect(selfAssignableRefusal({ ...safe, permissions: ["*"] })).toBe(
      "role.self_assignable_permissions",
    );
  });

  it("refuses every keyed role first, whatever else it is", () => {
    for (const key of ["PRESIDENT", "MEMBER", "NEW_MEMBER", "ALUMNI"]) {
      expect(
        selfAssignableRefusal({
          system_key: key,
          tier_id: "tier",
          permissions: ["*"],
        }),
      ).toBe("role.self_assignable_keyed");
    }
  });

  it("refuses a role in any tier", () => {
    expect(selfAssignableRefusal({ ...safe, tier_id: "tier-4" })).toBe(
      "role.self_assignable_tiered",
    );
  });

  it("reads missing fields as empty, and an empty key as a key", () => {
    expect(selfAssignableRefusal({})).toBeNull();
    expect(selfAssignableRefusal({ system_key: "" })).toBe(
      "role.self_assignable_keyed",
    );
  });
});

describe("refusal copy for role.not_self_assignable (#4958 review)", () => {
  // One code, several refusals: each keeps the API's own sentence, so an
  // officer's save race never reads as a member's picker refusal.
  it.each([
    "Members started picking this role while you were saving. Reload and try again.",
    "Alumni don't pick roles. Ask an officer if you need one.",
    "Officers give this role. Ask one if you need it.",
  ])("keeps %s", (message) => {
    expect(
      refusalCopy({ status: 409, code: NOT_SELF_ASSIGNABLE_CODE, message }),
    ).toBe(message);
  });
});
