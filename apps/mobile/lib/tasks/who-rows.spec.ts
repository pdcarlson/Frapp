import { describe, expect, it } from "vitest";
import { memberFallbackLabel } from "@repo/hooks/display-names";
import {
  buildWhoDirectory,
  GROUPS_HEADING,
  initialOpenTiers,
  OTHER_ROLES_HEADING,
  WHO_PICKER_COPY,
} from "@repo/hooks/task-who-picker";
import { whoOfLegacyAssignee, whoRows, type WhoRow } from "./who-rows";

/**
 * The phone's Assign to list (the Tasks overhaul § 2): which rows it draws.
 * The picker's rules are specced with them in
 * `packages/hooks/src/task-who-picker.spec.ts`.
 */
const directory = buildWhoDirectory({
  members: [
    { user_id: "u-viewer", display_name: "Paul Carlson", role_ids: ["exec"] },
    { user_id: "u-sam", display_name: "Sam Lee", role_ids: ["recruit"] },
    { user_id: "u-alex", display_name: "Alex Kim", role_ids: ["recruit"] },
    { user_id: "u-old", display_name: "Old Timer", role_ids: ["recruit"], is_alumni: true },
    { user_id: "u-blank", display_name: "  ", role_ids: [] },
  ],
  roles: [
    { id: "everyone", name: "Member", system_key: "MEMBER", display_order: 0 },
    { id: "alumni", name: "Alumni", system_key: "ALUMNI", display_order: 1 },
    { id: "exec", name: "President", tier_id: "t-exec", display_order: 2 },
    { id: "recruit", name: "Recruitment Committee", tier_id: "t-comm", display_order: 3 },
    { id: "loose", name: "Historian", tier_id: null, display_order: 4 },
  ],
  tiers: [
    { id: "t-comm", name: "Committees", position: 2 },
    { id: "t-exec", name: "Executive Board", position: 1 },
  ],
  groups: [
    { id: "g-phil", name: "Philanthropy", kind: "manual", member_ids: ["u-sam", "u-old"] },
    { id: "g-empty", name: "Formal planning", kind: "manual", member_ids: [] },
    { id: "g-auto", name: "Class of 2030", kind: "class", member_ids: ["u-old"] },
  ],
  viewerUserId: "u-viewer",
});

const BLANK = memberFallbackLabel("u-blank");

describe("whoRows", () => {
  const base = {
    search: "",
    single: false,
    expanded: new Set<string>(),
    openTiers: initialOpenTiers(null, directory),
  };
  const labels = (rows: WhoRow[]) =>
    rows.map((row) =>
      row.kind === "heading"
        ? `# ${row.label}`
        : row.kind === "person"
          ? `${row.nested ? "  " : ""}${row.person.name}`
          : row.kind === "set"
            ? row.set.name
            : "Everyone",
    );

  it("draws Everyone over the people", () => {
    expect(labels(whoRows(directory, { ...base, tab: "people" }))).toEqual([
      "Everyone",
      "Paul Carlson",
      "Alex Kim",
      BLANK,
      "Sam Lee",
    ]);
  });

  it("draws roles under their tiers, then the groups", () => {
    expect(labels(whoRows(directory, { ...base, tab: "sets" }))).toEqual([
      "Everyone",
      "# Executive Board",
      "President",
      "# Committees",
      "Recruitment Committee",
      `# ${OTHER_ROLES_HEADING}`,
      "Historian",
      `# ${GROUPS_HEADING}`,
      "Philanthropy",
      "Formal planning",
    ]);
  });

  it("opens a role onto its holders, and folds a tier", () => {
    const rows = whoRows(directory, {
      ...base,
      tab: "sets",
      expanded: new Set(["role:recruit"]),
      openTiers: new Set(["t-comm"]),
    });
    expect(labels(rows).slice(0, 6)).toEqual([
      "Everyone",
      "# Executive Board",
      "# Committees",
      "Recruitment Committee",
      "  Alex Kim",
      "  Sam Lee",
    ]);
  });

  it("searches people, roles and groups together", () => {
    expect(
      labels(whoRows(directory, { ...base, tab: "people", search: "p" })),
    ).toEqual([
      `# ${WHO_PICKER_COPY.people}`,
      "Paul Carlson",
      `# ${WHO_PICKER_COPY.rolesAndGroups}`,
      "President",
      "Philanthropy",
      "Formal planning",
    ]);
    expect(
      labels(whoRows(directory, { ...base, tab: "sets", search: "sam" })),
    ).toEqual([`# ${WHO_PICKER_COPY.people}`, "Sam Lee"]);
  });

  it("lists only people, with no Everyone, for one person", () => {
    expect(
      labels(whoRows(directory, { ...base, tab: "sets", single: true })),
    ).toEqual(["Paul Carlson", "Alex Kim", BLANK, "Sam Lee"]);
  });
});

describe("whoOfLegacyAssignee", () => {
  it("reads a kept draft's old assignee", () => {
    expect(whoOfLegacyAssignee(null)).toBeNull();
    expect(whoOfLegacyAssignee("everyone")).toEqual({
      kind: "each",
      target: { kind: "chapter" },
    });
    expect(whoOfLegacyAssignee("u-sam")).toEqual({ kind: "person", userId: "u-sam" });
  });
});
