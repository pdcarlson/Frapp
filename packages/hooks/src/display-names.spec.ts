import { describe, expect, it, vi } from "vitest";
import {
  authorGroupingKey,
  authorInitialsFallback,
  directChannelDisplayName,
  isServerGeneratedDmName,
  isServerGeneratedGroupDmName,
  resolveAuthorLabel,
  resolveAuthorName,
  memberFallbackLabel,
  resolveDisplayName,
  type DisplayNameMap,
} from "./display-names";

const VIEWER = "user-viewer";
const DM_NAME =
  "dm-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222";
const GROUP_DM_NAME = "group-dm-1755300000000";

const names: DisplayNameMap = {
  [VIEWER]: "Viewer Self",
  "user-a": "Alice Chen",
  "user-b": "Bob Ortiz",
  "user-c": "Carol Diaz",
  "user-d": "Dana Lowe",
  "user-e": "Eli Moss",
  "user-blank": "",
  "user-deleted": "Deleted User",
};

describe("memberFallbackLabel", () => {
  it("renders the first six characters of the id", () => {
    expect(memberFallbackLabel("8f14e45f-ceea-467a-9f1c-1a2b3c4d5e6f")).toBe(
      "Member 8f14e4",
    );
  });

  it("is what resolveAuthorLabel falls back to, so the two cannot drift", () => {
    // The label is a cross-surface identity: the same departed member has to
    // read identically in chat and on the points board, or an officer cannot
    // tell the two rows are one person.
    const id = "c9f0f895-fb98-4b41-9b8e-7d2a1c0b3e4d";
    expect(resolveAuthorLabel({ sender_id: id }, () => null, null)).toBe(
      memberFallbackLabel(id),
    );
  });

  it("tolerates an id shorter than the truncation", () => {
    expect(memberFallbackLabel("abc")).toBe("Member abc");
  });
});

describe("resolveDisplayName", () => {
  it("returns the name when one is set", () => {
    expect(resolveDisplayName(names, "user-a")).toBe("Alice Chen");
  });

  it("returns null for an empty name — the real missing-name case", () => {
    // users.display_name is NOT NULL DEFAULT '', so '' is what an unset name
    // actually looks like. Rendering it would produce a blank label.
    expect(resolveDisplayName(names, "user-blank")).toBeNull();
  });

  it("returns null for an id that is not in the roster", () => {
    expect(resolveDisplayName(names, "user-unknown")).toBeNull();
  });

  it("resolves a tombstoned account like any other name", () => {
    // anonymize_user writes 'Deleted User', so no special case is needed.
    expect(resolveDisplayName(names, "user-deleted")).toBe("Deleted User");
  });
});

describe("server-generated name detection", () => {
  it("recognises a server-generated DM name", () => {
    expect(isServerGeneratedDmName(DM_NAME)).toBe(true);
    expect(isServerGeneratedDmName("Exec board")).toBe(false);
  });

  it("recognises a server-generated group-DM name", () => {
    expect(isServerGeneratedGroupDmName(GROUP_DM_NAME)).toBe(true);
    expect(isServerGeneratedGroupDmName("Exec board")).toBe(false);
  });
});

describe("directChannelDisplayName", () => {
  it("leaves a non-direct channel alone even when named like a DM", () => {
    // Invariant: the rewrite is keyed on channel type, not on the name shape, so
    // a PUBLIC channel someone named `dm-<uuid>-<uuid>` keeps it.
    expect(
      directChannelDisplayName(
        { name: DM_NAME, type: "PUBLIC", member_ids: [] },
        VIEWER,
        names,
      ),
    ).toBe(DM_NAME);
  });

  it("keeps a caller-titled group DM's title", () => {
    // Invariant: createGroupDm persists a supplied name and only falls back to
    // `group-dm-<epoch>`, so a real title must never be replaced.
    expect(
      directChannelDisplayName(
        { name: "Exec board", type: "GROUP_DM", member_ids: ["user-a"] },
        VIEWER,
        names,
      ),
    ).toBe("Exec board");
  });

  it("resolves a 1:1 DM to the other participant", () => {
    expect(
      directChannelDisplayName(
        { name: DM_NAME, type: "DM", member_ids: [VIEWER, "user-a"] },
        VIEWER,
        names,
      ),
    ).toBe("Alice Chen");
  });

  it("subtracts the viewer, so a DM never renders your own name", () => {
    // The only resolvable member here is the viewer. Without the subtraction
    // this would read "Viewer Self".
    expect(
      directChannelDisplayName(
        { name: DM_NAME, type: "DM", member_ids: [VIEWER, "user-unknown"] },
        VIEWER,
        names,
      ),
    ).toBe("Direct message");
  });

  it("falls back to the placeholder with no viewer id", () => {
    expect(
      directChannelDisplayName(
        { name: DM_NAME, type: "DM", member_ids: [VIEWER, "user-a"] },
        null,
        names,
      ),
    ).toBe("Direct message");
  });

  it("never leaks the uuid name when the other participant is unresolvable", () => {
    expect(
      directChannelDisplayName(
        { name: DM_NAME, type: "DM", member_ids: [VIEWER, "user-blank"] },
        VIEWER,
        names,
      ),
    ).toBe("Direct message");
  });

  it("summarises a group DM's participants", () => {
    expect(
      directChannelDisplayName(
        {
          name: GROUP_DM_NAME,
          type: "GROUP_DM",
          member_ids: [VIEWER, "user-a", "user-b"],
        },
        VIEWER,
        names,
      ),
    ).toBe("Alice Chen, Bob Ortiz");
  });

  it("counts the overflow past three participants", () => {
    expect(
      directChannelDisplayName(
        {
          name: GROUP_DM_NAME,
          type: "GROUP_DM",
          member_ids: [
            VIEWER,
            "user-a",
            "user-b",
            "user-c",
            "user-d",
            "user-e",
          ],
        },
        VIEWER,
        names,
      ),
    ).toBe("Alice Chen, Bob Ortiz, Carol Diaz +2");
  });

  it("counts unnamed participants in the overflow rather than hiding them", () => {
    // Six others, three of them unresolvable. Counting only the named ones would
    // claim a three-person thread and collide with any other group sharing those
    // same three names.
    expect(
      directChannelDisplayName(
        {
          name: GROUP_DM_NAME,
          type: "GROUP_DM",
          member_ids: [
            VIEWER,
            "user-a",
            "user-b",
            "user-c",
            "user-blank",
            "user-unknown",
            "user-also-unknown",
          ],
        },
        VIEWER,
        names,
      ),
    ).toBe("Alice Chen, Bob Ortiz, Carol Diaz +3");
  });

  it("falls back for a group DM with nobody resolvable", () => {
    expect(
      directChannelDisplayName(
        {
          name: GROUP_DM_NAME,
          type: "GROUP_DM",
          member_ids: [VIEWER, "user-unknown"],
        },
        VIEWER,
        names,
      ),
    ).toBe("Group message");
  });

  it("treats a blank stored name as no title rather than a real one", () => {
    // `CreateGroupDmDto.name` is optional with no non-empty check, so `""` can
    // reach the client. Returning it verbatim would render an unlabeled row.
    expect(
      directChannelDisplayName(
        { name: "   ", type: "GROUP_DM", member_ids: [VIEWER, "user-a"] },
        VIEWER,
        names,
      ),
    ).toBe("Alice Chen");

    expect(
      directChannelDisplayName(
        { name: "", type: "GROUP_DM", member_ids: [VIEWER, "user-unknown"] },
        VIEWER,
        names,
      ),
    ).toBe("Group message");
  });

  it("handles an empty member list without throwing", () => {
    expect(
      directChannelDisplayName(
        { name: DM_NAME, type: "DM", member_ids: [] },
        VIEWER,
        names,
      ),
    ).toBe("Direct message");
  });
});

describe("resolveAuthorName", () => {
  const roster = (names: Record<string, string>) => (id: string) =>
    names[id] ?? null;

  it("prefers the live roster name over the recorded author_name", () => {
    // author_name is a snapshot from the source system; a roster hit is who the
    // person is now. Preferring the snapshot would show a member's old Discord
    // handle on a message they wrote under their real account.
    expect(
      resolveAuthorName(
        { sender_id: "u1", author_name: "old_discord_handle" },
        roster({ u1: "Marcus Reid" }),
      ),
    ).toBe("Marcus Reid");
  });

  it("falls back to author_name when the roster cannot resolve the sender", () => {
    expect(
      resolveAuthorName({ sender_id: "gone", author_name: "Marcus" }, roster({})),
    ).toBe("Marcus");
  });

  it("reads author_name when there is no sender at all", () => {
    expect(
      resolveAuthorName({ sender_id: null, author_name: "DiscordUser" }, roster({})),
    ).toBe("DiscordUser");
  });

  it("treats a blank author_name as absent", () => {
    expect(
      resolveAuthorName({ sender_id: null, author_name: "   " }, roster({})),
    ).toBeNull();
  });

  it("never calls the resolver for a null sender", () => {
    // The resolver signature takes a string; passing null through would be a
    // runtime type error in any caller that indexes with it.
    const nameFor = vi.fn(() => null);
    resolveAuthorName({ sender_id: null, author_name: "X" }, nameFor);
    expect(nameFor).not.toHaveBeenCalled();
  });
});

describe("authorInitialsFallback", () => {
  it("uses the first two characters of the sender id", () => {
    expect(
      authorInitialsFallback({ sender_id: "2f4a1c00-0000-0000-0000-000000000000" }),
    ).toBe("2F");
  });

  it("does not throw on a message with no sender", () => {
    // This is the crash. `message.sender_id.slice(0, 2)` was called
    // unconditionally in both the web avatar and the mobile one.
    expect(authorInitialsFallback({ sender_id: null })).toBe("?");
  });
});

describe("resolveAuthorLabel", () => {
  const roster = (names: Record<string, string>) => (id: string) =>
    names[id] ?? null;

  it("says 'You' for the viewer's own message", () => {
    expect(
      resolveAuthorLabel({ sender_id: "u1" }, roster({ u1: "Marcus Reid" }), "u1"),
    ).toBe("You");
  });

  it("renders the resolved display name for another member", () => {
    expect(
      resolveAuthorLabel({ sender_id: "u1" }, roster({ u1: "Marcus Reid" }), "u2"),
    ).toBe("Marcus Reid");
  });

  it("falls back to a truncated id only when the sender is unresolvable", () => {
    expect(
      resolveAuthorLabel(
        { sender_id: "22222222-2222-4222-8222-222222222222" },
        roster({}),
        null,
      ),
    ).toBe("Member 222222");
  });

  it("treats an empty resolved name as unresolvable rather than blank", () => {
    // users.display_name is NOT NULL DEFAULT '', so '' is the real "no name
    // set" case and a blank label is worse than a truncated id.
    expect(
      resolveAuthorLabel({ sender_id: "user-blank" }, roster({ "user-blank": "" }), null),
    ).toBe("Member user-b");
  });

  it("names an imported author with no Signet user behind it", () => {
    expect(
      resolveAuthorLabel(
        { sender_id: null, author_name: "DiscordUser", author_external_id: "9911" },
        roster({}),
        "u1",
      ),
    ).toBe("DiscordUser");
  });

  it("degrades to a readable label rather than a blank one", () => {
    // Unreachable against a healthy DB — chat_messages_author_present requires
    // an author_name whenever sender_id is null — but a label must render
    // something, and an empty string reads as a broken layout.
    expect(resolveAuthorLabel({ sender_id: null }, roster({}), null)).toBe(
      "Unknown member",
    );
  });
});

describe("authorGroupingKey", () => {
  it("groups two messages from the same member", () => {
    expect(authorGroupingKey({ sender_id: "u1" })).toBe(
      authorGroupingKey({ sender_id: "u1" }),
    );
  });

  it("does NOT group two different imported authors", () => {
    // The regression this exists for: comparing `sender_id` directly, `null ===
    // null` is true, so an imported channel where twenty Discord members spoke
    // in turn collapsed into one block under one name.
    const a = { sender_id: null, author_name: "Ada", author_external_id: "1" };
    const b = { sender_id: null, author_name: "Grace", author_external_id: "2" };
    expect(authorGroupingKey(a)).not.toBe(authorGroupingKey(b));
  });

  it("separates a Signet uuid from a source-system id that reads the same", () => {
    expect(authorGroupingKey({ sender_id: "1234" })).not.toBe(
      authorGroupingKey({ sender_id: null, author_external_id: "1234" }),
    );
  });

  it("falls back to the name when an imported row carries no external id", () => {
    expect(
      authorGroupingKey({ sender_id: null, author_name: "Ada" }),
    ).not.toBe(authorGroupingKey({ sender_id: null, author_name: "Grace" }));
  });
});
