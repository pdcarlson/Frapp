import { describe, expect, it } from "vitest";
import {
  CHAPTER_LOG_KINDS,
  chapterLogChanges,
  chapterLogChangeText,
  chapterLogKindActions,
  chapterLogPhrase,
  chapterLogSubject,
  chapterLogWindowStart,
} from "./chapter-logs";

describe("chapter logs", () => {
  it("files every action under at most one kind", () => {
    const seen = new Set<string>();
    for (const kind of CHAPTER_LOG_KINDS) {
      for (const action of kind.actions) {
        expect(seen.has(action), action).toBe(false);
        seen.add(action);
      }
    }
    expect(chapterLogKindActions("roles")).toContain("role_created");
    expect(chapterLogKindActions("nope")).toBeNull();
  });

  it("reads an action as words, a new one included", () => {
    expect(chapterLogPhrase("role_created")).toBe("added a role");
    expect(chapterLogPhrase("member_name_changed")).toBe("member name changed");
    expect(chapterLogPhrase("member_renamed")).toBe("changed their name");
  });

  it("names the record a row added or removed", () => {
    expect(
      chapterLogSubject({
        role: { from: null, to: { id: "x", name: "On Campus" } },
      }),
    ).toBe("On Campus");
    expect(
      chapterLogSubject({ group: { from: { name: "Third Floor" }, to: null } }),
    ).toBe("Third Floor");
    expect(chapterLogSubject({ name: { from: "A", to: "B" } })).toBeNull();
  });

  it("shows a field's values only when a person can read them", () => {
    const changes = chapterLogChanges({
      name: { from: "Non-Brothers", to: "Non-Brothers/PNMs" },
      ask: { from: false, to: true },
      logo_path: {
        from: "chapters/a/branding/logo-1.png",
        to: "chapters/a/branding/logo-2.png",
      },
      birthday_channel_id: {
        from: null,
        to: "ad716a62-5426-4aaa-b578-8e6653fc5dd0",
      },
      permissions: { added: [], removed: ["channels:manage"] },
      role: { from: null, to: { name: "On Campus" } },
    });
    expect(changes.map(chapterLogChangeText)).toEqual([
      "name: Non-Brothers → Non-Brothers/PNMs",
      "ask: off → on",
      "logo path",
      "birthday channel id",
      "permissions",
    ]);
  });

  it("counts a window back from now", () => {
    const now = new Date("2026-11-21T00:00:00.000Z");
    expect(chapterLogWindowStart("7d", now)).toBe("2026-11-14T00:00:00.000Z");
    expect(chapterLogWindowStart("any", now)).toBeUndefined();
  });
});
