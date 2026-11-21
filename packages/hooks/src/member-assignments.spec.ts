import { describe, expect, it } from "vitest";
import {
  ASSIGN_CAPTIONS,
  CHIP_PREVIEW_COUNT,
  cutChips,
  groupFollowsLabel,
  memberAssignmentSections,
  memberGroupChips,
  memberRoleChips,
} from "./member-assignments";
import type { ChapterGroup } from "./use-groups";
import type { Reach, TierRow, TieredRole } from "./role-tiers";

function role(
  id: string,
  name: string,
  tier_id: string | null,
  extra: Partial<TieredRole> = {},
): TieredRole {
  return {
    id,
    name,
    color: null,
    permissions: [],
    is_system: false,
    system_key: null,
    display_order: 1,
    mentionable: true,
    tier_id,
    permission_overrides: {},
    self_assignable: false,
    ...extra,
  };
}

const TIERS: TierRow[] = [
  {
    id: "t-exec",
    name: "Exec board",
    position: 1,
    permissions: [],
    mentionable: true,
  },
  {
    id: "t-chairs",
    name: "Chairs",
    position: 2,
    permissions: [],
    mentionable: true,
  },
];

const ROLES: TieredRole[] = [
  role("r-pres", "President", "t-exec", {
    permissions: ["*"],
    display_order: 0,
  }),
  role("r-vp", "Vice President", "t-exec"),
  role("r-rush", "Rush Chair", "t-chairs"),
  role("r-everyone", "Everyone", "t-chairs", {
    system_key: "MEMBER",
    is_system: true,
  }),
  role("r-past", "Past Cor Sec", null),
];

function group(
  id: string,
  name: string,
  member_ids: string[],
  kind: ChapterGroup["kind"] = "manual",
): ChapterGroup {
  return {
    id,
    name,
    kind,
    member_ids,
    color: null,
    mentionable: true,
  } as unknown as ChapterGroup;
}

const GROUPS = [
  group("g-house", "In house", ["u1"]),
  group("g-campus", "On campus", []),
  group("g-class", "Fall 2025", ["u1"], "pledge_class"),
];

/** A Vice President: in the top tier, so they reach the chairs only. */
const VP_REACH: Reach = {
  wildcard: false,
  known: true,
  rank: 1,
  held: new Set(["roles:manage", "groups:manage"]),
};

function sections(
  overrides: Partial<Parameters<typeof memberAssignmentSections>[0]> = {},
) {
  return memberAssignmentSections({
    roles: ROLES,
    tiers: TIERS,
    groups: GROUPS,
    reach: VP_REACH,
    canManageRoles: true,
    canManageGroups: true,
    heldRoleIds: ["r-rush"],
    userId: "u1",
    ...overrides,
  });
}

describe("memberAssignmentSections", () => {
  it("lists roles under their tiers, then roles outside them, then the chapter's own groups", () => {
    expect(sections().map((s) => [s.title, s.rows.map((r) => r.name)])).toEqual(
      [
        ["Exec board", ["President", "Vice President"]],
        ["Chairs", ["Rush Chair"]],
        ["Other roles", ["Past Cor Sec"]],
        ["Groups", ["In house", "On campus"]],
      ],
    );
  });

  it("never offers the Everyone role or a group that follows the member's details", () => {
    const names = sections().flatMap((s) => s.rows.map((r) => r.name));
    expect(names).not.toContain("Everyone");
    expect(names).not.toContain("Fall 2025");
  });

  it("marks what the member has", () => {
    const rows = sections().flatMap((s) => s.rows);
    expect(rows.filter((r) => r.held).map((r) => r.name)).toEqual([
      "Rush Chair",
      "In house",
    ]);
  });

  it("shows a role the viewer can't give, with why, instead of hiding it", () => {
    const rows = sections().flatMap((s) => s.rows);
    const reason = (name: string) =>
      rows.find((r) => r.name === name)?.disabledReason;
    expect(reason("President")).toBe(ASSIGN_CAPTIONS.presidency);
    expect(reason("Vice President")).toBe(ASSIGN_CAPTIONS.ranksAbove);
    expect(reason("Rush Chair")).toBeNull();
    expect(reason("Past Cor Sec")).toBeNull();
    expect(reason("In house")).toBeNull();
  });

  it("says a viewer without the permission can't change roles or groups", () => {
    const rows = sections({
      canManageRoles: false,
      canManageGroups: false,
    }).flatMap((s) => s.rows);
    expect(rows.find((r) => r.name === "Rush Chair")?.disabledReason).toBe(
      ASSIGN_CAPTIONS.noRoles,
    );
    expect(rows.find((r) => r.name === "In house")?.disabledReason).toBe(
      ASSIGN_CAPTIONS.noGroups,
    );
  });

  it("waits for the viewer's own roles before calling a role out of reach", () => {
    const rows = sections({ reach: { ...VP_REACH, known: false } }).flatMap(
      (s) => s.rows,
    );
    expect(rows.find((r) => r.name === "Rush Chair")?.disabledReason).toBe(
      ASSIGN_CAPTIONS.checking,
    );
  });

  // #5725: the member's rank counts too, and roles:assign_own_level lets a
  // viewer reach their own level as well as below it.
  it("disables every role on a member ranked at the viewer's level, unless they can assign at their own level", () => {
    const peer = (reach: Reach) =>
      sections({ reach, heldRoleIds: ["r-vp"], userId: "u-peer" }).flatMap(
        (s) => s.rows,
      );
    const reason = (rows: ReturnType<typeof peer>, name: string) =>
      rows.find((r) => r.name === name)?.disabledReason;

    const plain = peer(VP_REACH);
    expect(reason(plain, "Rush Chair")).toBe(ASSIGN_CAPTIONS.memberAbove);

    const ownLevel = peer({
      ...VP_REACH,
      held: new Set([...VP_REACH.held, "roles:assign_own_level"]),
    });
    expect(reason(ownLevel, "Rush Chair")).toBeNull();
    expect(reason(ownLevel, "Vice President")).toBeNull();
    expect(reason(ownLevel, "President")).toBe(ASSIGN_CAPTIONS.presidency);
  });

  it("never lets the viewer reach a member ranked above them", () => {
    const rows = sections({
      reach: {
        ...VP_REACH,
        rank: 2,
        held: new Set([...VP_REACH.held, "roles:assign_own_level"]),
      },
      heldRoleIds: ["r-vp"],
      userId: "u-vp",
    }).flatMap((s) => s.rows);
    expect(rows.find((r) => r.name === "Rush Chair")?.disabledReason).toBe(
      ASSIGN_CAPTIONS.memberAbove,
    );
  });

  it("treats the viewer's own profile as reachable", () => {
    const rows = sections({
      reach: { ...VP_REACH, userId: "u-me" },
      heldRoleIds: ["r-vp"],
      userId: "u-me",
    }).flatMap((s) => s.rows);
    expect(
      rows.find((r) => r.name === "Rush Chair")?.disabledReason,
    ).toBeNull();
  });

  it("searches roles and groups alike, and drops sections it empties", () => {
    expect(sections({ query: "  CAMP" }).map((s) => s.title)).toEqual([
      "Groups",
    ]);
    expect(sections({ query: "chair" }).map((s) => s.title)).toEqual([
      "Chairs",
    ]);
  });
});

describe("memberRoleChips", () => {
  it("orders by rank and lets the viewer take away only what they could give", () => {
    const chips = memberRoleChips({
      roles: ROLES,
      tiers: TIERS,
      heldRoleIds: ["r-past", "r-rush", "r-vp", "r-everyone"],
      reach: VP_REACH,
      canManageRoles: true,
    });
    expect(chips.map((c) => [c.name, c.removable])).toEqual([
      ["Vice President", false],
      ["Rush Chair", true],
      ["Past Cor Sec", true],
    ]);
  });
});

describe("memberGroupChips", () => {
  it("lists the chapter's own groups first and never lets a followed one be removed", () => {
    expect(
      memberGroupChips(GROUPS, "u1", true).map((c) => [c.name, c.removable]),
    ).toEqual([
      ["In house", true],
      ["Fall 2025", false],
    ]);
    expect(
      memberGroupChips(GROUPS, "u1", false).every((c) => !c.removable),
    ).toBe(true);
  });
});

describe("cutChips", () => {
  const eight = [
    "P",
    "VP",
    "Treasurer",
    "Rush",
    "Social",
    "Floor 2",
    "Tree",
    "Math",
  ];

  it("shows the first three of eight, then +5 more", () => {
    const cut = cutChips(eight, false);
    expect(CHIP_PREVIEW_COUNT).toBe(3);
    expect(cut.shown).toEqual(["P", "VP", "Treasurer"]);
    expect(cut.hidden).toBe(5);
    expect(cut.toggle).toEqual({ label: "+5 more", expands: true });
  });

  it("opens to all of them in order, with Show less", () => {
    const cut = cutChips(eight, true);
    expect(cut.shown).toEqual(eight);
    expect(cut.hidden).toBe(0);
    expect(cut.toggle).toEqual({ label: "Show less", expands: false });
  });

  it("never folds away a single chip, and needs no toggle for a short row", () => {
    for (const n of [0, 1, 3, 4]) {
      const chips = eight.slice(0, n);
      for (const expanded of [false, true]) {
        expect(cutChips(chips, expanded)).toEqual({
          shown: chips,
          hidden: 0,
          toggle: null,
        });
      }
    }
    expect(cutChips(eight.slice(0, 5), false).toggle?.label).toBe("+2 more");
  });

  it("cuts a member's eight roles to their three highest-ranked", () => {
    // Listed out of order, as the API may send them.
    const roles = [
      role("r-floor", "Floor 2", null, { display_order: 0 }),
      role("r-social", "Social Chair", "t-chairs", { display_order: 3 }),
      ...ROLES,
      role("r-tree", "Tree", null, { display_order: 2 }),
      role("r-treas", "Treasurer", "t-exec", { display_order: 2 }),
      role("r-alumni", "Alumni", null, { is_system: true, display_order: 9 }),
    ];
    const chips = memberRoleChips({
      roles,
      tiers: TIERS,
      heldRoleIds: roles.map((r) => r.id),
      reach: VP_REACH,
      canManageRoles: false,
    });
    const names = (list: { name: string }[]) => list.map((c) => c.name);
    expect(names(chips)).toEqual([
      "President",
      "Vice President",
      "Treasurer",
      "Rush Chair",
      "Social Chair",
      // Outside the tiers: a system role above the chapter's own.
      "Alumni",
      "Floor 2",
      "Past Cor Sec",
      "Tree",
    ]);
    const folded = cutChips(chips, false);
    expect(names(folded.shown)).toEqual([
      "President",
      "Vice President",
      "Treasurer",
    ]);
    expect(folded.toggle?.label).toBe("+6 more");
    expect(names(cutChips(chips, true).shown)).toEqual(names(chips));
describe("groupFollowsLabel", () => {
  it("says what each automatic group follows, and nothing for a manual one", () => {
    expect(
      (["manual", "pledge_class", "class_year", "major"] as const).map((kind) =>
        groupFollowsLabel({ kind }),
      ),
    ).toEqual([
      null,
      "Follows pledge class",
      "Follows graduation year",
      "Follows major",
    ]);
  });
});
