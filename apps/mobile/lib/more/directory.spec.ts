import { describe, expect, it } from "vitest";
import { selectActives, selectDirectoryRows } from "./directory";

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
    // The shared `Member <6>` label, the same words web renders for this member.
    const [row] = selectDirectoryRows([
      { user_id: "2f4a1c9d-0000-4000-8000-000000000000", display_name: "" },
    ]);
    expect(row?.displayName).toBe("Member 2f4a1c");
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

// #2484: a chapter with alumni. `GET /v1/members` returns all of them; the
// Actives tab must not, or the "Actives" chip counts alumni the "Alumni" chip
// also counts. That the two tabs partition the chapter is checked against the
// screen itself, with separate members and alumni payloads, in
// `directory-screen.spec.tsx`.
describe("selectActives", () => {
  const chapter = [
    { user_id: "u-1", display_name: "Marcus Reid", is_alumni: false },
    { user_id: "u-2", display_name: "Charles Whitmore III", is_alumni: true },
    { user_id: "u-3", display_name: "Andre Silva", is_alumni: false },
    { user_id: "u-4", display_name: "Daniel Kirkpatrick", is_alumni: true },
  ];

  it("keeps only the members the server did not flag as alumni", () => {
    expect(
      selectDirectoryRows(selectActives(chapter)).map((row) => row.displayName),
    ).toEqual(["Andre Silva", "Marcus Reid"]);
  });

  it("treats a row without the flag as active, as an older API would send it", () => {
    expect(
      selectActives([{ user_id: "u-1", display_name: "Marcus Reid" }]),
    ).toHaveLength(1);
  });

  it("is empty for a payload that isn't a list", () => {
    expect(selectActives(undefined)).toEqual([]);
  });
});
