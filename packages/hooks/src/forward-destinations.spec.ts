import { describe, expect, it } from "vitest";
import {
  FORWARD_REFUSED_BODY,
  FORWARD_RETRY_BODY,
  FORWARD_UNAVAILABLE_BODY,
  filterForwardDestinations,
  forwardDestinations,
  forwardFailureBody,
} from "./forward-destinations";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";
const BOB = "33333333-3333-4333-8333-333333333333";
const NAMES = { [ALICE]: "Alice Chen", [BOB]: "Bob Ortiz" };

describe("forwardDestinations", () => {
  const channels = [
    {
      id: "c-random",
      name: "random",
      type: "PUBLIC",
      can_post: true,
      member_ids: [],
    },
    {
      id: "c-announce",
      name: "announcements",
      type: "PUBLIC",
      can_post: false,
      member_ids: [],
    },
    { id: "c-general", name: "general", type: "PUBLIC", member_ids: [] },
    {
      id: "c-audit",
      name: "chapter-audit",
      type: "PUBLIC",
      is_audit_log: true,
      member_ids: [],
    },
    {
      id: "dm-bob",
      name: `dm-${VIEWER}-${BOB}`,
      type: "DM",
      member_ids: [VIEWER, BOB],
    },
    {
      id: "dm-alice",
      name: `dm-${VIEWER}-${ALICE}`,
      type: "DM",
      member_ids: [VIEWER, ALICE],
      can_post: true,
    },
    {
      id: "dm-hidden",
      name: `dm-${VIEWER}-x`,
      type: "DM",
      member_ids: [VIEWER, "x"],
      hidden: true,
    },
  ];

  it("offers channels A to Z, then people by name, leaving out what the viewer can't post in", () => {
    expect(forwardDestinations(channels, VIEWER, NAMES)).toEqual([
      { id: "c-general", label: "#general", direct: false },
      { id: "c-random", label: "#random", direct: false },
      { id: "dm-alice", label: "Alice Chen", direct: true },
      { id: "dm-bob", label: "Bob Ortiz", direct: true },
    ]);
  });

  it("finds a channel with or without its #, and a person by part of their name", () => {
    const rows = forwardDestinations(channels, VIEWER, NAMES);
    const ids = (query: string) =>
      filterForwardDestinations(rows, query).map((row) => row.id);
    expect(ids("gen")).toEqual(["c-general"]);
    expect(ids("#GEN")).toEqual(["c-general"]);
    expect(ids("ortiz")).toEqual(["dm-bob"]);
    expect(ids("  ")).toHaveLength(4);
    expect(ids("zzz")).toEqual([]);
  });
});

describe("forwardFailureBody", () => {
  it("says a refusal can't be retried, and anything else can", () => {
    expect(forwardFailureBody({ statusCode: 403 })).toBe(
      FORWARD_UNAVAILABLE_BODY,
    );
    expect(forwardFailureBody({ statusCode: 404 })).toBe(
      FORWARD_UNAVAILABLE_BODY,
    );
    expect(forwardFailureBody({ statusCode: 400 })).toBe(FORWARD_REFUSED_BODY);
    expect(forwardFailureBody({ statusCode: 503 })).toBe(FORWARD_RETRY_BODY);
    expect(forwardFailureBody(new TypeError("Network request failed"))).toBe(
      FORWARD_RETRY_BODY,
    );
  });
});
