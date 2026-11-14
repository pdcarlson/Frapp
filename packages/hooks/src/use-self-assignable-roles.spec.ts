import { describe, expect, it } from "vitest";
import { selectPickableRoles } from "./use-self-assignable-roles";

describe("selectPickableRoles (#4958)", () => {
  const row = (id: string, name: string, self_assignable: boolean) => ({
    id,
    name,
    permissions: [],
    is_system: false,
    system_key: null,
    self_assignable,
  });

  it("keeps only marked roles, by name, each saying whether the viewer holds it", () => {
    const roles = selectPickableRoles(
      [
        row("r-study", "Study group", true),
        row("r-chair", "Social chair", false),
        row("r-im", "Intramurals", true),
      ],
      ["R-IM", "r-chair"],
    );
    expect(roles.map((r) => [r.name, r.held])).toEqual([
      ["Intramurals", true],
      ["Study group", false],
    ]);
  });

  it("offers an alum nothing, as the API refuses them", () => {
    const alumni = { ...row("r-alum", "Alumni", false), system_key: "ALUMNI" };
    expect(
      selectPickableRoles(
        [alumni, row("r-im", "Intramurals", true)],
        ["r-alum"],
      ),
    ).toEqual([]);
  });

  it("reads a missing flag or payload as nothing to pick", () => {
    expect(selectPickableRoles([{ id: "a", name: "A" }], [])).toEqual([]);
    expect(selectPickableRoles(undefined, undefined)).toEqual([]);
  });
});
