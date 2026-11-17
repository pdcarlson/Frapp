import { describe, expect, it } from "vitest";
import { auditLogAllowsChange, isServerWrittenLine } from "./chat-audit-log";
import { SYSTEM_SENDER_ID } from "./chat-message";

describe("isServerWrittenLine", () => {
  it("is a system_audit row, or anything the system actor sent", () => {
    expect(isServerWrittenLine({ kind: "system_audit" })).toBe(true);
    expect(isServerWrittenLine({ sender_id: SYSTEM_SENDER_ID })).toBe(true);
    expect(
      isServerWrittenLine({ kind: "text", sender_id: SYSTEM_SENDER_ID }),
    ).toBe(true);
  });

  it("is not a member's message", () => {
    expect(isServerWrittenLine({ kind: "text", sender_id: "user-1" })).toBe(
      false,
    );
    expect(isServerWrittenLine({ sender_id: null })).toBe(false);
  });
});

describe("auditLogAllowsChange", () => {
  const entry = { kind: "system_audit", sender_id: SYSTEM_SENDER_ID };
  const memberPost = { kind: "text", sender_id: "user-1" };

  it("never takes a new pin or flag, on any line", () => {
    for (const line of [entry, memberPost]) {
      expect(auditLogAllowsChange("pin", line)).toBe(false);
      expect(auditLogAllowsChange("flag", line)).toBe(false);
    }
  });

  it("always lets a pin or a flag come off", () => {
    for (const line of [entry, memberPost]) {
      expect(auditLogAllowsChange("unpin", line)).toBe(true);
      expect(auditLogAllowsChange("unflag", line)).toBe(true);
    }
  });

  it("deletes a member's post but never one of Frapp's entries", () => {
    expect(auditLogAllowsChange("delete", memberPost)).toBe(true);
    expect(auditLogAllowsChange("delete", entry)).toBe(false);
    // A report's snapshot carries the sender only.
    expect(
      auditLogAllowsChange("delete", { sender_id: SYSTEM_SENDER_ID }),
    ).toBe(false);
  });
});
