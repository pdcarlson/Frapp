import { describe, expect, it } from "vitest";
import { followerChoices } from "./task-follower-choices";
import { buildWhoDirectory } from "./task-who-picker";

/**
 * From's choices (#5473, tasks.md § Following a task): the tiers, roles and
 * groups the viewer is in, never a class year or the tier holding Everyone.
 */
const roles = [
  {
    id: "everyone",
    name: "Member",
    system_key: "MEMBER",
    tier_id: "t-all",
    display_order: 0,
  },
  { id: "pres", name: "President", tier_id: "t-exec", display_order: 1 },
  { id: "vp", name: "Vice President", tier_id: "t-exec", display_order: 2 },
  {
    id: "recruit",
    name: "Recruitment Chair",
    tier_id: "t-comm",
    display_order: 3,
  },
  { id: "chaplain", name: "Chaplain", tier_id: "t-all", display_order: 4 },
];
const groups = [
  {
    id: "g-phil",
    name: "Philanthropy",
    kind: "manual",
    member_ids: ["u-viewer", "u-sam"],
  },
  {
    id: "g-formal",
    name: "Formal planning",
    kind: "manual",
    member_ids: ["u-sam"],
  },
  {
    id: "g-2027",
    name: "Class of 2027",
    kind: "class_year",
    member_ids: ["u-viewer"],
  },
];
const directory = buildWhoDirectory({
  members: [
    {
      user_id: "u-viewer",
      display_name: "Paul Carlson",
      role_ids: ["pres", "chaplain"],
    },
    { user_id: "u-sam", display_name: "Sam Lee", role_ids: ["vp", "recruit"] },
    { user_id: "u-alex", display_name: "Alex Kim", role_ids: [] },
  ],
  roles,
  tiers: [
    { id: "t-all", name: "Chapter", position: 0 },
    { id: "t-exec", name: "Exec board", position: 1 },
    { id: "t-comm", name: "Committees", position: 2 },
  ],
  groups,
  viewerUserId: "u-viewer",
});

describe("followerChoices", () => {
  it("lists the viewer's tiers, roles and groups, each with its count", () => {
    expect(followerChoices(directory, { roles, groups })).toEqual([
      { entry: "tier:t-exec", kind: "tier", name: "Exec board", count: 2 },
      { entry: "role:chaplain", kind: "role", name: "Chaplain", count: 1 },
      { entry: "role:pres", kind: "role", name: "President", count: 1 },
      { entry: "group:g-phil", kind: "group", name: "Philanthropy", count: 2 },
    ]);
  });

  it("offers nothing before the viewer is known", () => {
    const anonymous = buildWhoDirectory({
      members: [
        { user_id: "u-sam", display_name: "Sam Lee", role_ids: ["vp"] },
      ],
      roles,
      groups,
      viewerUserId: null,
    });
    expect(followerChoices(anonymous, { roles, groups })).toEqual([]);
  });
});
