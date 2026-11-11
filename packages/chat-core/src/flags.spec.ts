import { describe, expect, it } from "vitest";
import type { BlockState } from "./blocks";
import {
  MESSAGE_FLAG_OPTIONS,
  canFlagMessage,
  messageFlagCaption,
  messageFlagView,
} from "./flags";
import { normalizeRow } from "./types";

const ready = (blocked: string[] = []): BlockState => ({
  status: "ready",
  ids: new Set(blocked),
  unblocked: new Set(),
  cleared: new Set(),
});
const names: Record<string, string> = { marcus: "Marcus", devin: "Devin" };
const nameFor = (id: string) => names[id] ?? null;

const message = (overrides: Record<string, unknown> = {}) => ({
  ...normalizeRow({
    id: "m1",
    channel_id: "c1",
    sender_id: "devin",
    content: "tailgate at 11",
    created_at: "2026-11-11T12:00:00.000Z",
  }),
  ...overrides,
});

describe("messageFlagView (#3921)", () => {
  it("draws nothing for an unflagged or deleted message", () => {
    expect(messageFlagView(message(), "v", ready(), nameFor)).toBeNull();
    expect(
      messageFlagView(
        message({ flag: "important", is_deleted: true }),
        "v",
        ready(),
        nameFor,
      ),
    ).toBeNull();
  });

  it("names no one when the sender flagged their own message", () => {
    const view = messageFlagView(
      message({ flag: "important", flagged_by: "devin" }),
      "v",
      ready(),
      nameFor,
    );
    expect(view).toEqual({
      flag: "important",
      label: "Important",
      important: true,
      flaggedBy: null,
    });
    expect(messageFlagCaption(view!)).toBe("Important");
  });

  it("names someone else who flagged it, and the viewer as you", () => {
    const byMarcus = messageFlagView(
      message({ flag: "funny", flagged_by: "marcus" }),
      "v",
      ready(),
      nameFor,
    );
    expect(byMarcus).toMatchObject({ important: false, flaggedBy: "Marcus" });
    expect(messageFlagCaption(byMarcus!)).toBe("Funny · flagged by Marcus");
    expect(
      messageFlagView(
        message({ flag: "funny", flagged_by: "v" }),
        "v",
        ready(),
        nameFor,
      )?.flaggedBy,
    ).toBe("you");
  });

  it("keeps the flag but drops a blocked flagger's name, and an unvouched one", () => {
    const flagged = message({ flag: "important", flagged_by: "marcus" });
    expect(
      messageFlagView(flagged, "v", ready(["marcus"]), nameFor),
    ).toMatchObject({ flag: "important", flaggedBy: null });
    expect(
      messageFlagView(flagged, "v", { ...ready(), status: "loading" }, nameFor)
        ?.flaggedBy,
    ).toBeNull();
  });
});

describe("canFlagMessage (#3921)", () => {
  it("lets any viewer flag an unflagged, confirmed message", () => {
    expect(canFlagMessage(message(), "v", false)).toBe(true);
  });

  it("offers no control on a pending, deleted or blocked row, or with no viewer", () => {
    expect(canFlagMessage(message({ _status: "pending" }), "v", false)).toBe(
      false,
    );
    expect(canFlagMessage(message({ is_deleted: true }), "v", false)).toBe(
      false,
    );
    expect(canFlagMessage(message({ sender_blocked: true }), "v", false)).toBe(
      false,
    );
    expect(canFlagMessage(message(), null, false)).toBe(false);
  });

  it("follows the shared rule once a message is flagged", () => {
    const flagged = message({ flag: "important", flagged_by: "marcus" });
    expect(canFlagMessage(flagged, "v", false)).toBe(false);
    expect(canFlagMessage(flagged, "marcus", false)).toBe(true);
    expect(canFlagMessage(flagged, "devin", false)).toBe(true);
    expect(canFlagMessage(flagged, "v", true)).toBe(true);
  });

  it("lists Important first", () => {
    expect(MESSAGE_FLAG_OPTIONS[0]).toEqual({
      flag: "important",
      label: "Important",
    });
  });
});
