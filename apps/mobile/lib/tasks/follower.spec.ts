import { describe, expect, it } from "vitest";
import {
  followerLabel,
  listedFollowers,
  type FollowerChoice,
} from "@repo/hooks/task-follower-choices";
import { TASK_FOLLOWER_COPY } from "@repo/validation";
import { followerOptions } from "./follower";

/** The phone's From sheet (#5473): its rows, headings and label. */
/** Stored entries name rows by uuid (`parseTaskFollower`). */
const TREASURER = "role:6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f";
const GONE = "group:0d9e8f7a-6b5c-4d3e-9f21-0a1b2c3d4e5f";

const choices: FollowerChoice[] = [
  { entry: "tier:t-exec", kind: "tier", name: "Exec board", count: 4 },
  { entry: "role:pres", kind: "role", name: "President", count: 1 },
  { entry: "group:g-phil", kind: "group", name: "Philanthropy", count: 6 },
  { entry: "group:g-formal", kind: "group", name: "Formal planning", count: 3 },
];

describe("followerOptions", () => {
  it("leads with Just you, then each kind under its heading with its count", () => {
    expect(
      followerOptions(choices, null).map((option) => [
        option.heading ?? "",
        option.value,
        option.label,
      ]),
    ).toEqual([
      ["", null, TASK_FOLLOWER_COPY.justYou],
      ["Tiers", "tier:t-exec", "Exec board · 4"],
      ["Roles", "role:pres", "President · 1"],
      ["Groups", "group:g-phil", "Philanthropy · 6"],
      ["", "group:g-formal", "Formal planning · 3"],
    ]);
  });

  it("says the count in words to a screen reader", () => {
    expect(followerOptions(choices, null)[2].accessibilityLabel).toBe(
      "President, 1 person",
    );
    expect(followerOptions(choices, null)[1].accessibilityLabel).toBe(
      "Exec board, 4 people",
    );
  });

  it("draws no heading for a kind the officer is in nothing of", () => {
    const headings = followerOptions(choices.slice(2), null)
      .map((option) => option.heading)
      .filter(Boolean);
    expect(headings).toEqual(["Groups"]);
  });
});

describe("listedFollowers and followerLabel", () => {
  it("keeps the task's own follower the officer isn't in, by its read's name", () => {
    const listed = listedFollowers(choices, TREASURER, "Treasurer");
    expect(listed.at(-1)).toEqual({
      entry: TREASURER,
      kind: "role",
      name: "Treasurer",
      count: 0,
    });
    expect(followerLabel(choices, TREASURER, "Treasurer")).toBe("Treasurer");
    // No count for it: the viewer's reads don't say how many it reaches.
    expect(
      followerOptions(choices, TREASURER, "Treasurer").find(
        (option) => option.value === TREASURER,
      )?.label,
    ).toBe("Treasurer");
  });

  it("names a deleted follower and Just you", () => {
    expect(followerLabel(choices, GONE, null)).toBe(TASK_FOLLOWER_COPY.deleted);
    expect(followerLabel(choices, null)).toBe(TASK_FOLLOWER_COPY.justYou);
    expect(followerLabel(choices, "tier:t-exec")).toBe("Exec board");
  });

  it("adds nothing for a value that isn't an entry", () => {
    expect(listedFollowers(choices, "nonsense")).toEqual(choices);
  });
});
