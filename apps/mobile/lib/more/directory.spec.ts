import { describe, expect, it } from "vitest";
import { selectDirectoryRows } from "./directory";

describe("selectDirectoryRows", () => {
  it("narrows a member profile into a drawable row", () => {
    expect(
      selectDirectoryRows([
        {
          user_id: "u-1",
          display_name: "Marcus Reid",
          graduation_year: 2027,
          current_company: "MechE",
          current_city: null,
          avatar_url: null,
        },
      ]),
    ).toEqual([
      {
        userId: "u-1",
        displayName: "Marcus Reid",
        initials: "MR",
        meta: "MechE · '27",
        avatarUrl: null,
      },
    ]);
  });

  it("sorts by display name so the list is scannable", () => {
    const rows = selectDirectoryRows([
      { user_id: "u-2", display_name: "Zoe Adams" },
      { user_id: "u-1", display_name: "Andre Silva" },
      { user_id: "u-3", display_name: "Marcus Reid" },
    ]);
    expect(rows.map((row) => row.displayName)).toEqual([
      "Andre Silva",
      "Marcus Reid",
      "Zoe Adams",
    ]);
  });

  // `user_id` is the id chat, DMs and every other surface key members on. A row
  // without one cannot be navigated from, so it is not drawn at all.
  it("drops a row with no user id", () => {
    expect(
      selectDirectoryRows([
        { display_name: "Nobody" },
        { user_id: "u-1", display_name: "Somebody" },
      ]),
    ).toHaveLength(1);
  });

  it("falls back for an unset display name rather than rendering blank", () => {
    const [row] = selectDirectoryRows([{ user_id: "u-1", display_name: "" }]);
    expect(row?.displayName).toBe("Unnamed member");
    expect(row?.initials).toBe("?");
  });

  // Absent parts must not leave a dangling separator.
  it("omits the meta line entirely when nothing is known", () => {
    const [row] = selectDirectoryRows([
      { user_id: "u-1", display_name: "Dev Kapoor" },
    ]);
    expect(row?.meta).toBeNull();
  });

  it("joins only the parts that are present", () => {
    const [row] = selectDirectoryRows([
      { user_id: "u-1", display_name: "Dev Kapoor", graduation_year: 2028 },
    ]);
    expect(row?.meta).toBe("'28");
  });

  it("returns an empty list for an absent payload", () => {
    expect(selectDirectoryRows(undefined)).toEqual([]);
    expect(selectDirectoryRows({ members: [] })).toEqual([]);
  });
});
