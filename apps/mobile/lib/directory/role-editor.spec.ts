import { describe, expect, it } from "vitest";
import {
  filterRoleOptions,
  orderRoleOptions,
  parseRoleOptions,
  customRolesCaption,
  removesBaseAccess,
  rolesSaveFailedBody,
  toggleRole,
} from "./role-editor";

const ROLES = [
  { id: "r-pres", name: "President", is_system: true, permissions: ["*"] },
  {
    id: "r-member",
    name: "Member",
    is_system: true,
    permissions: ["members:view"],
  },
  // Discord-imported: no system flag, only a channel read.
  {
    id: "r-brothers",
    name: "Brothers",
    is_system: false,
    permissions: ["channels:read:brothers"],
    // A palette color, in any case.
    color: "#f2994a",
  },
  {
    id: "r-cabinet",
    name: "cabinet",
    is_system: false,
    permissions: ["channels:read:cabinet"],
    // Off the palette: paints no dot (`roleColorOrNull`).
    color: "#ff0000",
  },
  {
    id: "r-rush",
    name: "Rush Guest",
    is_system: false,
    permissions: ["members:view"],
  },
  { name: "No id" },
];

describe("parseRoleOptions", () => {
  const options = parseRoleOptions(ROLES);

  it("drops rows without an id or name", () => {
    expect(options.map((o) => o.id)).toEqual([
      "r-pres",
      "r-member",
      "r-brothers",
      "r-cabinet",
      "r-rush",
    ]);
  });

  it("locks wildcard roles and marks which roles open basic access", () => {
    const byId = Object.fromEntries(options.map((o) => [o.id, o]));
    expect(byId["r-pres"].locked).toBe(true);
    expect(byId["r-member"].locked).toBe(false);
    expect(byId["r-member"].grantsBase).toBe(true);
    expect(byId["r-rush"].grantsBase).toBe(true);
    expect(byId["r-brothers"].grantsBase).toBe(false);
    expect(byId["r-brothers"].color).toBe("#F2994A");
    expect(byId["r-cabinet"].color).toBeNull();
  });

  it("reads anything that isn't a list as no roles", () => {
    expect(parseRoleOptions(undefined)).toEqual([]);
    expect(parseRoleOptions({ error: "nope" })).toEqual([]);
  });
});

describe("orderRoleOptions", () => {
  it("puts held roles first, then the rest, each by name ignoring case", () => {
    const ordered = orderRoleOptions(parseRoleOptions(ROLES), [
      "r-member",
      "r-brothers",
    ]);
    expect(ordered.map((o) => o.name)).toEqual([
      "Brothers",
      "Member",
      "cabinet",
      "President",
      "Rush Guest",
    ]);
  });
});

describe("filterRoleOptions", () => {
  const options = parseRoleOptions(ROLES);
  it("matches any part of the name, ignoring case and outer spaces", () => {
    expect(filterRoleOptions(options, "  CAB ").map((o) => o.id)).toEqual([
      "r-cabinet",
    ]);
    expect(filterRoleOptions(options, "")).toBe(options);
  });
});

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

describe("base access", () => {
  const options = parseRoleOptions(ROLES);

  it("counts roles carrying members:view, not Discord channel roles or the seeded flag", () => {
    const grants = (id: string) => options.find((o) => o.id === id)?.grantsBase;
    expect(grants("r-brothers")).toBe(false);
    expect(grants("r-cabinet")).toBe(false);
    expect(grants("r-member")).toBe(true);
    expect(grants("r-rush")).toBe(true);
    // A seeded role whose members:view was edited away grants nothing.
    const edited = parseRoleOptions([
      { id: "r-new", name: "New Member", is_system: true, permissions: [] },
    ]);
    expect(edited[0]?.grantsBase).toBe(false);
  });

  it("warns only on the change that takes basic access away", () => {
    expect(
      removesBaseAccess(["r-brothers", "r-member"], ["r-brothers"], options),
    ).toBe(true);
    expect(removesBaseAccess(["r-member", "r-rush"], ["r-rush"], options)).toBe(
      false,
    );
    // Already locked out: adding or removing a channel role doesn't warn.
    expect(
      removesBaseAccess(["r-brothers", "r-cabinet"], ["r-brothers"], options),
    ).toBe(false);
  });
});

describe("rolesSaveFailedBody", () => {
  it("only offers a retry when trying again could work", () => {
    expect(rolesSaveFailedBody(400)).toContain("deleted");
    expect(rolesSaveFailedBody(403)).toContain("isn't allowed any more");
    expect(rolesSaveFailedBody(undefined)).toContain("Try again");
    expect(rolesSaveFailedBody(undefined, "Ada")).toMatch(
      /^Your change to Ada's roles didn't reach the server/,
    );
  });
});

describe("customRolesCaption", () => {
  it("names the custom roles this editor leaves alone", () => {
    expect(customRolesCaption([])).toBeNull();
    expect(customRolesCaption(["Rush Chair"])).toBe(
      "Rush Chair is a custom role, changed on the web.",
    );
  });
});
