import { describe, expect, it } from "vitest";
import type { AskSource } from "./ask";
import { askSourceChip } from "./ask-source-chip";

const CHAT: AskSource = {
  id: "s1",
  kind: "chat",
  title: "#general",
  detail: null,
  date: "2026-11-09T18:00:00.000Z",
  target: null,
};

describe("askSourceChip", () => {
  it("says whose message it is and when, for a chat source that names its author", () => {
    const chip = askSourceChip({ ...CHAT, author: "Ana Ruiz" });
    expect(chip.name).toBe("Ana Ruiz in #general");
    expect(chip.when).toBe("November 9, 2026");
    expect(chip.meta).toContain("November 9, 2026");
  });

  it("reads as the title alone without an author, or with a blank one", () => {
    expect(askSourceChip(CHAT)).toMatchObject({ name: "#general", when: null });
    expect(askSourceChip({ ...CHAT, author: "  " })).toMatchObject({
      name: "#general",
      when: null,
    });
    expect(askSourceChip({ ...CHAT, author: null }).name).toBe("#general");
  });

  it("shows no day for an authored source that carries none", () => {
    expect(
      askSourceChip({ ...CHAT, author: "Ana Ruiz", date: null }).when,
    ).toBeNull();
  });
});
