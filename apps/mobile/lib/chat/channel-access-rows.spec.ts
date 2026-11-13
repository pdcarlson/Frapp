import { describe, expect, it } from "vitest";
import type { ChannelAccessOption } from "@repo/hooks/channel-access";
import {
  channelAccessRows,
  channelAccessSummaryLine,
} from "./channel-access-rows";

function option(
  entry: string,
  name: string,
  users: string[] = [],
  extra: Partial<ChannelAccessOption> = {},
): ChannelAccessOption {
  const [kind, id] = entry.split(":") as [string, string];
  return {
    entry,
    kind,
    id,
    name,
    color: null,
    tier_id: null,
    user_ids: users,
    ...extra,
  };
}

const options = [
  option("role:a", "Alumni", ["u9"]),
  option("tier:exec", "Executive", ["u1", "u2"]),
  option("role:b", "Brothers", ["u2", "u3"]),
  option("role:e", "Everyone", ["u1", "u2", "u3"], { hidden: true }),
];

const labels = (rows: ReturnType<typeof channelAccessRows>) =>
  rows.map((row) => (row.kind === "heading" ? `# ${row.label}` : row.key));

describe("channelAccessRows (#3702)", () => {
  it("groups tiers then roles, leading each with what was on the list", () => {
    expect(labels(channelAccessRows(options, new Set(["role:b"]), ""))).toEqual(
      ["# Tiers", "tier:exec", "# Roles", "role:b", "role:a"],
    );
  });

  it("offers a hidden role only while the list names it", () => {
    expect(
      labels(channelAccessRows(options, new Set(["role:e"]), "")),
    ).toContain("role:e");
  });

  it("narrows by word starts and drops empty groups", () => {
    expect(labels(channelAccessRows(options, new Set(), "bro"))).toEqual([
      "# Roles",
      "role:b",
    ]);
  });
});

describe("channelAccessSummaryLine", () => {
  it("says what each answer means", () => {
    expect(channelAccessSummaryLine("see", null, options, true)).toBe(
      "Everyone in the chapter can see it.",
    );
    expect(channelAccessSummaryLine("post", [], options, true)).toBe(
      "Pick a tier, role or group. Until you do, only the President can post.",
    );
    expect(
      channelAccessSummaryLine("see", ["tier:exec", "role:b"], options, true),
    ).toBe("Reaches 3 people. The President can always see it.");
    expect(channelAccessSummaryLine("see", ["role:b"], options, false)).toBe(
      "The President can always see it.",
    );
  });
});
