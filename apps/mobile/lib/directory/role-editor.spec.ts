import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { describe, expect, it } from "vitest";
import { rolesSaveFailedBody, toggleRole } from "./role-editor";

describe("toggleRole", () => {
  it("adds at the end and removes in place, keeping ids the list doesn't know", () => {
    expect(toggleRole(["r-gone", "r-member"], "r-brothers")).toEqual([
      "r-gone",
      "r-member",
      "r-brothers",
    ]);
    expect(toggleRole(["r-gone", "r-member"], "r-member")).toEqual(["r-gone"]);
  });

  it("collapses duplicate ids the API may hold", () => {
    expect(toggleRole(["r-member", "r-member"], "r-brothers")).toEqual([
      "r-member",
      "r-brothers",
    ]);
  });
});

describe("rolesSaveFailedBody", () => {
  it("only offers a retry when trying again could work", () => {
    expect(rolesSaveFailedBody(400)).toContain("deleted");
    expect(rolesSaveFailedBody(403)).toContain("isn't allowed any more");
    expect(rolesSaveFailedBody(409)).toContain("at the same time");
    expect(rolesSaveFailedBody(undefined)).toContain("Try again");
    expect(rolesSaveFailedBody(undefined, "Ada")).toMatch(
      /^Your change to Ada's roles didn't reach the server/,
    );
  });
});

describe("the Everyone role and the base roles (2026-11-21)", () => {
  const options = parseChapterRoles([
    {
      id: "r-everyone",
      name: "Everyone",
      system_key: "EVERYONE",
      permissions: ["members:view"],
    },
    {
      id: "r-new",
      name: "New Member",
      system_key: "NEW_MEMBER",
      permissions: ["members:view"],
    },
    {
      id: "r-actives",
      name: "Brothers",
      system_key: "MEMBER",
      permissions: ["members:view"],
    },
    { id: "r-chair", name: "Rush Chair", permissions: ["tasks:manage"] },
  ]);

  it("keeps Everyone and swaps the base role, as the API does", () => {
    // A pledge made a brother stops being a pledge.
    expect(toggleRole(["r-new", "r-everyone"], "r-actives", options)).toEqual([
      "r-actives",
      "r-everyone",
    ]);
    // Taking the base role away leaves Everyone.
    expect(
      toggleRole(["r-actives", "r-everyone"], "r-actives", options),
    ).toEqual(["r-everyone"]);
  });
});
