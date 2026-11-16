import { describe, expect, it } from "vitest";
import {
  buildRolePickerMessage,
  readRolePickerPayload,
  rolePickerRows,
} from "./role-pickers";

describe("role pickers (#4958)", () => {
  it("posts its title as content, with a default and no repeated role", () => {
    expect(
      buildRolePickerMessage({ title: "  ", roleIds: ["a", "b", "a"] }),
    ).toEqual({
      content: "Pick your roles",
      payload: { title: "Pick your roles", role_ids: ["a", "b"] },
    });
    expect(
      buildRolePickerMessage({ title: " Teams ", roleIds: ["a"] }).content,
    ).toBe("Teams");
  });

  it("reads a payload, and refuses one with no roles", () => {
    expect(
      readRolePickerPayload({ payload: { title: "T", role_ids: ["a", 3] } }),
    ).toEqual({ title: "T", role_ids: ["a"] });
    expect(
      readRolePickerPayload({ payload: { title: "T", role_ids: [] } }),
    ).toBeNull();
    expect(readRolePickerPayload({ payload: null })).toBeNull();
  });

  it("gives each viewer Join, Leave, or no button, and drops deleted roles", () => {
    const rows = rolePickerRows(
      { title: "T", role_ids: ["join", "LEAVE", "closed", "gone"] },
      [
        { id: "join", name: "Intramurals", held: false, joinable: true },
        { id: "leave", name: "Chess", held: true, joinable: false },
      ],
      [
        { id: "join", name: "Intramurals" },
        { id: "leave", name: "Chess" },
        { id: "closed", name: "Band" },
      ],
    );
    expect(rows).toEqual([
      { id: "join", name: "Intramurals", action: "join" },
      { id: "leave", name: "Chess", action: "leave" },
      { id: "closed", name: "Band", action: "closed" },
    ]);
  });
});
