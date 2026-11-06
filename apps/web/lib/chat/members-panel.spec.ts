import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_MEMBERS_HIDDEN_COOKIE,
  parseMembersHidden,
  persistMembersHidden,
} from "./members-panel";

function cookieValue(): string | undefined {
  return document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(`${CHAT_MEMBERS_HIDDEN_COOKIE}=`))
    ?.split("=")[1];
}

describe("member list preference", () => {
  afterEach(() => {
    document.cookie = `${CHAT_MEMBERS_HIDDEN_COOKIE}=; Max-Age=0; Path=/`;
  });

  it("reads back exactly what the toggle writes", () => {
    persistMembersHidden(true);
    expect(parseMembersHidden(cookieValue())).toBe(true);
    persistMembersHidden(false);
    expect(parseMembersHidden(cookieValue())).toBe(false);
  });

  it("shows the column for an absent or foreign value", () => {
    expect(parseMembersHidden(undefined)).toBe(false);
    expect(parseMembersHidden("true")).toBe(false);
  });
});
