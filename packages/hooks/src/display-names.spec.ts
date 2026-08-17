import { describe, expect, it } from "vitest";
import {
  directChannelDisplayName,
  isServerGeneratedDmName,
  isServerGeneratedGroupDmName,
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
