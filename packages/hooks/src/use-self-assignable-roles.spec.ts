import { describe, expect, it } from "vitest";
import { selectPickableRoles } from "./use-self-assignable-roles";

describe("selectPickableRoles (#4958)", () => {
  const row = (
    id: string,
    name: string,
    self_assignable: boolean,
    tier_id: string | null = null,
  ) => ({
    id,
    name,
    permissions: [],
    is_system: false,
    system_key: null as string | null,
    tier_id,
    self_assignable,
  });

  it("lists marked roles by name, each saying whether the viewer holds it", () => {
    const roles = selectPickableRoles(
      [
        row("r-study", "Study group", true),
        row("r-chair", "Social chair", false, "tier-1"),
        row("r-im", "Intramurals", true),
      ],
      ["R-IM", "r-chair"],
    );
    expect(roles.map((r) => [r.name, r.held, r.joinable])).toEqual([
      ["Intramurals", true, true],
      ["Study group", false, true],
    ]);
  });

  it("keeps a held role an officer unmarked, to leave only", () => {
    // The API lets a member leave any unkeyed role outside the tiers, so a
    // role unmarked after they picked it never traps them.
    const roles = selectPickableRoles(
      [
        row("r-im", "Intramurals", false),
        row("r-chess", "Chess", false),
        row("r-chair", "Social chair", false, "tier-1"),
        { ...row("r-member", "Member", false), system_key: "MEMBER" },
      ],
      ["r-im", "r-chair", "r-member"],
    );
    expect(roles.map((r) => [r.name, r.held, r.joinable])).toEqual([
      ["Intramurals", true, false],
    ]);
  });

  it("offers an alum nothing to join, but lets them leave what they hold", () => {
    // The API refuses an alum's join, not their leave.
    const alumni = { ...row("r-alum", "Alumni", false), system_key: "ALUMNI" };
    const roles = selectPickableRoles(
      [alumni, row("r-im", "Intramurals", true), row("r-vg", "Games", true)],
      ["r-alum", "r-vg"],
    );
    expect(roles.map((r) => [r.name, r.held, r.joinable])).toEqual([
      ["Games", true, false],
    ]);
  });

  it("reads a missing flag or payload as nothing to pick", () => {
    expect(selectPickableRoles([{ id: "a", name: "A" }], [])).toEqual([]);
    expect(selectPickableRoles(undefined, undefined)).toEqual([]);
  });
});
