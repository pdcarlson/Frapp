import { describe, expect, it } from "vitest";
import {
  defaultRoleChoice,
  matchFrappRole,
  privateReads,
  roleIssues,
  sameAsDiscordReaders,
  type FrappRole,
} from "./role-matching";

const frappRoles: FrappRole[] = [
  { id: "president", name: "President", system_key: "PRESIDENT" },
  { id: "vp", name: "Vice President", system_key: "VICE_PRESIDENT" },
  { id: "treasurer", name: "Treasurer", system_key: "TREASURER" },
  { id: "secretary", name: "Secretary", system_key: "SECRETARY" },
  { id: "member", name: "Member", system_key: "MEMBER" },
  { id: "new-member", name: "New Member", system_key: "NEW_MEMBER" },
  { id: "alumni", name: "Alumni", system_key: "ALUMNI" },
  { id: "exec", name: "Exec Board", system_key: null },
];

const matched = (name: string) => {
  const match = matchFrappRole(name, frappRoles);
  return match ? [match.role.id, match.kind] : null;
};

describe("matchFrappRole (#2818)", () => {
  it("matches the same name first, ignoring case and punctuation, custom roles included", () => {
    expect(matched("exec-board")).toEqual(["exec", "same-name"]);
    expect(matched("VICE PRESIDENT")).toEqual(["vp", "same-name"]);
  });

  it("then a close match to a seeded role, read from the end of the name", () => {
    expect(matched("Recording Secretary")).toEqual(["secretary", "close"]);
    expect(matched("Pledges")).toEqual(["new-member", "close"]);
    expect(matched("Pledge Class 2026")).toBeNull();
    expect(matched("Alum")).toEqual(["alumni", "close"]);
    expect(matched("Brothers")).toEqual(["member", "close"]);
    expect(matched("VP")).toEqual(["vp", "close"]);
    // The longest alias wins, so a vice president is never the President.
    expect(matched("Executive Vice President")).toEqual(["vp", "close"]);
  });

  it("reads Member only from a whole name, since it is the widest role", () => {
    expect(matched("Actives")).toEqual(["member", "close"]);
    expect(matched("Active Members")).toEqual(["member", "close"]);
    // Officer titles that end in "member" are not every member.
    expect(matched("Board Member")).toBeNull();
    expect(matched("Executive Board Member")).toBeNull();
    expect(matched("Alumni Member")).toBeNull();
  });

  it("tells names in other scripts apart, and matches nothing on an emoji alone", () => {
    const greek = [
      ...frappRoles,
      { id: "delta-class", name: "ΔΔ Class", system_key: null },
      { id: "alpha-beta", name: "ΑΒ", system_key: null },
    ];
    expect(matchFrappRole("ΓΓ Class", greek)).toBeNull();
    expect(matchFrappRole("δδ class", greek)?.role.id).toBe("delta-class");
    // Vowel signs are part of Devanagari letters, not accents to fold.
    const hindi = [
      ...frappRoles,
      { id: "karyakari", name: "कार्यकारी", system_key: null },
    ];
    expect(matchFrappRole("कर्यकरी", hindi)).toBeNull();
    expect(matchFrappRole("कार्यकारी", hindi)?.role.id).toBe("karyakari");
    // An emoji-only name has no key, even beside an emoji-only Frapp role,
    // and even when one carries a variation selector.
    const emoji = [...frappRoles, { id: "star", name: "⭐️", system_key: null }];
    expect(matchFrappRole("🔥", emoji)).toBeNull();
    expect(matchFrappRole("🎮️", emoji)).toBeNull();
  });

  it("does not read an officer as the people they look after", () => {
    // "Pledge Educator" is an educator; matching New Member would let every
    // pledge read the officer channels.
    expect(matched("Pledge Educator")).toBeNull();
    expect(matched("Alumni Relations Chair")).toBeNull();
    expect(matched("Rush Chair")).toBeNull();
  });

  it("matches seeded roles by system key, so a renamed one still matches", () => {
    const renamed = frappRoles.map((role) =>
      role.id === "secretary" ? { ...role, name: "Scribe" } : role,
    );
    expect(matchFrappRole("Corresponding Secretary", renamed)?.role.id).toBe(
      "secretary",
    );
  });
});

describe("defaultRoleChoice (#2818)", () => {
  const role = (roleName: string) => ({ roleId: "r1", roleName });

  it("uses the match, else a new role if it could read a private channel, else Ignore", () => {
    expect(
      defaultRoleChoice(role("Treasurer"), frappRoles, true, true),
    ).toEqual({
      choice: { action: "existing", roleId: "treasurer" },
      kind: "same-name",
    });
    expect(
      defaultRoleChoice(role(" Rush Chair "), frappRoles, true, true),
    ).toEqual({ choice: { action: "new", name: "Rush Chair" }, kind: null });
    expect(defaultRoleChoice(role("Gamers"), frappRoles, false, true)).toEqual({
      choice: { action: "ignore" },
      kind: null,
    });
  });

  it("starts everything at Ignore for a viewer who cannot manage roles", () => {
    expect(
      defaultRoleChoice(role("Treasurer"), frappRoles, true, false).choice,
    ).toEqual({ action: "ignore" });
  });
});

describe("roleIssues (#2818)", () => {
  const roles = [
    { roleId: "r1", roleName: "Rush Chair" },
    { roleId: "r2", roleName: "exec" },
    { roleId: "r3", roleName: "Long" },
  ];

  it("asks for a name no Frapp role has, within the limit", () => {
    expect(
      roleIssues(
        roles,
        {
          r1: { action: "new", name: "  " },
          r2: { action: "new", name: "EXEC BOARD" },
          r3: { action: "new", name: "x".repeat(51) },
        },
        frappRoles,
        50,
      ).map((issue) => issue.message),
    ).toEqual([
      "Name the new role for Rush Chair.",
      'A role named "Exec Board" already exists. Map exec to it instead of creating a new one.',
      "The new role for Long needs a shorter name (at most 50 characters).",
    ]);
  });
});

describe("sameAsDiscordReaders (#2818)", () => {
  const roles = [
    { roleId: "r-exec", roleName: "Exec" },
    { roleId: "r-rush", roleName: "Rush Chair" },
    { roleId: "r-pledge", roleName: "Pledge" },
  ];
  const channel = {
    channelId: "c1",
    channelName: "exec",
    category: null,
    privateInDiscord: true,
    readerRoleIds: ["r-exec", "r-rush", "r-pledge"],
  };

  it("names the Frapp roles it resolves to, and the Discord roles left out", () => {
    expect(
      sameAsDiscordReaders(
        channel,
        roles,
        {
          "r-exec": { action: "existing", roleId: "exec" },
          "r-rush": { action: "new", name: "Rush Chair" },
          "r-pledge": { action: "ignore" },
        },
        frappRoles,
      ),
    ).toEqual({
      roles: ["Exec Board", "Rush Chair (new)"],
      ignored: ["Pledge"],
    });
  });

  it("is not on offer for a channel the scan saw no Discord audience for", () => {
    expect(
      sameAsDiscordReaders(
        { ...channel, privateInDiscord: false },
        roles,
        {},
        frappRoles,
      ),
    ).toBeNull();
    expect(
      sameAsDiscordReaders(
        { ...channel, readerRoleIds: null },
        roles,
        {},
        frappRoles,
      ),
    ).toBeNull();
    // Hidden only by a deny: every role reads it by inheriting.
    expect(
      sameAsDiscordReaders(
        { ...channel, readerRoleIds: [] },
        roles,
        {},
        frappRoles,
      ),
    ).toBeNull();
  });

  it("counts how many private channels each role could read", () => {
    expect(
      privateReads([channel, { ...channel, readerRoleIds: ["r-exec"] }]),
    ).toEqual(
      new Map([
        ["r-exec", 2],
        ["r-rush", 1],
        ["r-pledge", 1],
      ]),
    );
  });
});
