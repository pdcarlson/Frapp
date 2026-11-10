import { describe, expect, it } from "vitest";
import { selectActives, selectDirectoryRows } from "./directory";

describe("selectDirectoryRows", () => {
  it("narrows a member profile into a drawable row", () => {
    expect(
      selectDirectoryRows([
        {
          id: "m-u-1",
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
        memberId: "m-u-1",
        userId: "u-1",
        displayName: "Marcus Reid",
        initials: "MR",
        meta: "MechE · '27",
        avatarUrl: null,
        pledgeClassId: null,
        orderNumber: null,
      },
    ]);
  });

  describe("pledge class and fraternal order (#3939)", () => {
    const CLASS_NAMES = new Map([
      ["pc-alpha", "Alpha"],
      ["pc-beta", "Beta"],
    ]);
    const MEMBERS = [
      { id: "m-1", user_id: "u-1", display_name: "Zoe Adams", pledge_class_id: "pc-alpha", order_number: 2, graduation_year: 2027 },
      { id: "m-2", user_id: "u-2", display_name: "Andre Silva", pledge_class_id: "pc-beta", order_number: 1 },
      { id: "m-3", user_id: "u-3", display_name: "Marcus Reid", pledge_class_id: "pc-alpha", order_number: 1 },
      { id: "m-4", user_id: "u-4", display_name: "Ben Ortiz" },
      { id: "m-5", user_id: "u-5", display_name: "Cal Young", pledge_class_id: "pc-alpha" },
      { id: "m-6", user_id: "u-6", display_name: "Dev Patel", order_number: 40 },
    ];

    it("leads a member's meta line with their class when its name is known", () => {
      const rows = selectDirectoryRows(MEMBERS, { classNames: CLASS_NAMES });
      const zoe = rows.find((row) => row.userId === "u-1");
      expect(zoe?.meta).toBe("Alpha · '27");
      expect(zoe?.pledgeClassId).toBe("pc-alpha");
      expect(zoe?.orderNumber).toBe(2);
      // No class, so nothing stands in for one.
      expect(rows.find((row) => row.userId === "u-4")?.meta).toBeNull();
    });

    it("names no class without the chapter's list, or for a class it doesn't hold", () => {
      expect(
        selectDirectoryRows(MEMBERS).find((row) => row.userId === "u-1")?.meta,
      ).toBe("'27");
      expect(
        selectDirectoryRows(MEMBERS, {
          classNames: new Map([["pc-beta", "Beta"]]),
        }).find((row) => row.userId === "u-1")?.meta,
      ).toBe("'27");
    });

    it("stays alphabetical unless asked for fraternal order", () => {
      expect(
        selectDirectoryRows(MEMBERS, { classNames: CLASS_NAMES }).map(
          (row) => row.displayName,
        ),
      ).toEqual([
        "Andre Silva",
        "Ben Ortiz",
        "Cal Young",
        "Dev Patel",
        "Marcus Reid",
        "Zoe Adams",
      ]);
    });

    it("lists oldest class first, then number, then the class-less by number, then the rest by name", () => {
      expect(
        selectDirectoryRows(MEMBERS, {
          classNames: CLASS_NAMES,
          fraternalOrder: [{ id: "pc-alpha" }, { id: "pc-beta" }],
        }).map((row) => row.displayName),
      ).toEqual([
        "Marcus Reid", // Alpha 1
        "Zoe Adams", // Alpha 2
        "Cal Young", // Alpha, no number
        "Andre Silva", // Beta 1
        "Dev Patel", // no class, number 40
        "Ben Ortiz", // neither
      ]);
    });

    it("follows the chapter's class order, not the names'", () => {
      expect(
        selectDirectoryRows(MEMBERS, {
          fraternalOrder: [{ id: "pc-beta" }, { id: "pc-alpha" }],
        })[0]?.displayName,
      ).toBe("Andre Silva");
    });
  });

  it("sorts by display name so the list is scannable", () => {
    const rows = selectDirectoryRows([
      { id: "m-u-2", user_id: "u-2", display_name: "Zoe Adams" },
      { id: "m-u-1", user_id: "u-1", display_name: "Andre Silva" },
      { id: "m-u-3", user_id: "u-3", display_name: "Marcus Reid" },
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
        { id: "m-u-1", user_id: "u-1", display_name: "Somebody" },
      ]),
    ).toHaveLength(1);
  });

  // `GET /v1/members/{id}` takes the member row's id, not the user id, so the
  // profile sheet needs both; a row missing either cannot open it.
  it("keeps the member id the profile route takes and drops a row without one", () => {
    const rows = selectDirectoryRows([
      { user_id: "u-2", display_name: "No member id" },
      { id: "m-1", user_id: "u-1", display_name: "Somebody" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: "m-1", userId: "u-1" });
  });

  it("falls back for an unset display name rather than rendering blank", () => {
    // The shared `Member <6>` label, the same words web renders for this member.
    const [row] = selectDirectoryRows([
      {
        id: "m-x",
        user_id: "2f4a1c9d-0000-4000-8000-000000000000",
        display_name: "",
      },
    ]);
    expect(row?.displayName).toBe("Member 2f4a1c");
    expect(row?.initials).toBe("?");
  });

  // Absent parts must not leave a dangling separator.
  it("omits the meta line entirely when nothing is known", () => {
    const [row] = selectDirectoryRows([
      { id: "m-u-1", user_id: "u-1", display_name: "Dev Kapoor" },
    ]);
    expect(row?.meta).toBeNull();
  });

  it("joins only the parts that are present", () => {
    const [row] = selectDirectoryRows([
      {
        id: "m-u-1",
        user_id: "u-1",
        display_name: "Dev Kapoor",
        graduation_year: 2028,
      },
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
    {
      id: "m-u-1",
      user_id: "u-1",
      display_name: "Marcus Reid",
      is_alumni: false,
    },
    {
      id: "m-u-2",
      user_id: "u-2",
      display_name: "Charles Whitmore III",
      is_alumni: true,
    },
    {
      id: "m-u-3",
      user_id: "u-3",
      display_name: "Andre Silva",
      is_alumni: false,
    },
    {
      id: "m-u-4",
      user_id: "u-4",
      display_name: "Daniel Kirkpatrick",
      is_alumni: true,
    },
  ];

  it("keeps only the members the server did not flag as alumni", () => {
    expect(
      selectDirectoryRows(selectActives(chapter)).map((row) => row.displayName),
    ).toEqual(["Andre Silva", "Marcus Reid"]);
  });

  it("treats a row without the flag as active, as an older API would send it", () => {
    expect(
      selectActives([
        { id: "m-u-1", user_id: "u-1", display_name: "Marcus Reid" },
      ]),
    ).toHaveLength(1);
  });

  it("is empty for a payload that isn't a list", () => {
    expect(selectActives(undefined)).toEqual([]);
  });
});
