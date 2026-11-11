import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_FLAGS,
  CHAT_MESSAGE_FLAG_LABELS,
  canChangeMessageFlag,
  isChatMessageFlag,
} from "./chat-message-flags";

describe("canChangeMessageFlag", () => {
  const flagged = {
    sender_id: "author",
    flagged_by: "flagger",
    flag: "important",
  };

  it("lets anyone add a flag to a message that has none", () => {
    expect(
      canChangeMessageFlag(
        { sender_id: "author", flagged_by: null, flag: null },
        "anyone",
        false,
      ),
    ).toBe(true);
  });

  it("lets the sender, the flagger or an officer change a flag", () => {
    expect(canChangeMessageFlag(flagged, "author", false)).toBe(true);
    expect(canChangeMessageFlag(flagged, "flagger", false)).toBe(true);
    expect(canChangeMessageFlag(flagged, "officer", true)).toBe(true);
  });

  it("refuses anyone else once a message is flagged", () => {
    expect(canChangeMessageFlag(flagged, "bystander", false)).toBe(false);
  });

  it("does not treat a missing flagger as a match for a null viewer id", () => {
    // A flagger whose account was deleted leaves `flagged_by` null.
    expect(
      canChangeMessageFlag(
        { sender_id: null, flagged_by: null, flag: "funny" },
        "bystander",
        false,
      ),
    ).toBe(false);
  });
});

describe("CHAT_MESSAGE_FLAGS", () => {
  it("labels every flag", () => {
    for (const flag of CHAT_MESSAGE_FLAGS) {
      expect(CHAT_MESSAGE_FLAG_LABELS[flag]).toBeTruthy();
    }
    expect(isChatMessageFlag("important")).toBe(true);
    expect(isChatMessageFlag("urgent")).toBe(false);
    expect(isChatMessageFlag(null)).toBe(false);
  });

  it("matches the database CHECK constraint", () => {
    const dir = path.resolve(__dirname, "../../../supabase/migrations");
    const file = readdirSync(dir).find((name) =>
      name.endsWith("_chat_message_flags.sql"),
    );
    expect(file).toBeDefined();
    const sql = readFileSync(path.join(dir, file!), "utf8");
    const match = sql.match(/flag in \(([^)]*)\)/i);
    expect(match).not.toBeNull();
    const inDb = [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(inDb).toEqual([...CHAT_MESSAGE_FLAGS]);
  });
});
