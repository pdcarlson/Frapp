import { describe, it, expect } from "vitest";
import { formatLocaleDate } from "@repo/formatting";
import { CHAT_REPORT_QUEUE_PERMISSIONS } from "@repo/validation";
import {
  CHAT_REPORT_TABS,
  chatReportActionLabel,
  chatReportCopy,
  messageExcerpt,
  reportAge,
  reportDistinction,
  reportedMessageSubject,
} from "./chat-report-copy";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

describe("reportAge", () => {
  it("reads the first minute as just now", () => {
    expect(reportAge(ago(59_000), NOW)).toBe("just now");
  });

  it("reads a clock skewed into the future as just now, never as 'in 2 minutes'", () => {
    expect(reportAge(ago(-2 * MINUTE), NOW)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(reportAge(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    expect(reportAge(ago(3 * 60 * MINUTE), NOW)).toBe("3 hours ago");
    expect(reportAge(ago(24 * 60 * MINUTE), NOW)).toBe("yesterday");
    expect(reportAge(ago(4 * 24 * 60 * MINUTE), NOW)).toBe("4 days ago");
  });

  it("falls back to a date past thirty days", () => {
    const old = ago(45 * 24 * 60 * MINUTE);
    expect(reportAge(old, NOW)).toBe(formatLocaleDate(old));
  });

  it("renders nothing for an unparseable timestamp rather than 'NaN minutes ago'", () => {
    expect(reportAge("not a date", NOW)).toBe("");
  });
});

describe("CHAT_REPORT_TABS", () => {
  it("covers every report status exactly once, open first", () => {
    expect(CHAT_REPORT_TABS.map((tab) => tab.status)).toEqual([
      "open",
      "reviewed",
      "actioned",
      "dismissed",
    ]);
  });
});

describe("chatReportCopy.deniedDescription", () => {
  it("names every permission the queue requires", () => {
    // The copy restates the shared list in words; the gate itself reads the
    // constant. If a permission is added to the queue, this fails until the
    // explanation says so too.
    for (const permission of CHAT_REPORT_QUEUE_PERMISSIONS) {
      expect(chatReportCopy.deniedDescription).toContain(permission);
    }
  });
});

describe("messageExcerpt", () => {
  it("keeps a short message whole, with whitespace collapsed", () => {
    expect(messageExcerpt("  go\n\naway  ")).toBe("go away");
  });

  it("cuts a long message at forty characters with an ellipsis", () => {
    const excerpt = messageExcerpt(
      "You should quit the chapter, nobody wants you here at all",
    );
    expect(excerpt).toBe("You should quit the chapter, nobody wan…");
    expect(excerpt!.length).toBeLessThanOrEqual(40);
  });

  it("is null for a message with no text", () => {
    expect(messageExcerpt(null)).toBeNull();
    expect(messageExcerpt("   ")).toBeNull();
  });
});

describe("row accessible names", () => {
  const report = reportDistinction({
    reason: "harassment",
    age: "5 minutes ago",
    hasNote: true,
  });

  it("starts with the visible label and names the message and the report it acts on", () => {
    const subject = reportedMessageSubject("Harper Lane", "go away");
    expect(chatReportActionLabel.dismissed(subject, report)).toBe(
      "Dismiss report on message from Harper Lane, “go away” (Harassment, reported 5 minutes ago, with a reporter's note)",
    );
    expect(chatReportActionLabel.remove(subject, report)).toBe(
      "Remove message from Harper Lane, “go away” (Harassment, reported 5 minutes ago, with a reporter's note)",
    );
    expect(chatReportActionLabel.reviewed(subject, report)).toMatch(
      /^Mark reviewed/,
    );
    expect(chatReportActionLabel.actioned(subject, report)).toMatch(
      /^Mark actioned/,
    );
  });

  it("says the message had no text, rather than naming the author alone", () => {
    expect(reportedMessageSubject("old_handle", null)).toBe(
      "message from old_handle with no text",
    );
  });

  it("tells two reports on one message apart by reason, age and note", () => {
    // Two members reported the same message: author and excerpt match, so
    // the subject does too. The report's own details are what differ.
    const subject = reportedMessageSubject("Harper Lane", "go away");
    const names = [
      reportDistinction({
        reason: "harassment",
        age: "5 minutes ago",
        hasNote: false,
      }),
      reportDistinction({
        reason: "spam",
        age: "5 minutes ago",
        hasNote: false,
      }),
      reportDistinction({
        reason: "harassment",
        age: "2 hours ago",
        hasNote: false,
      }),
      reportDistinction({
        reason: "harassment",
        age: "5 minutes ago",
        hasNote: true,
      }),
    ].map((details) => chatReportActionLabel.dismissed(subject, details));
    expect(new Set(names).size).toBe(names.length);
  });

  it("leaves the age out when the timestamp could not be read", () => {
    expect(reportDistinction({ reason: "spam", age: "", hasNote: false })).toBe(
      "Spam",
    );
  });
});

describe("the removal confirmation", () => {
  it("names the author and quotes the message", () => {
    expect(chatReportCopy.removeConfirm.title("Harper Lane")).toBe(
      "Remove the message from Harper Lane?",
    );
    expect(chatReportCopy.removeConfirm.description("go away")).toMatch(
      /^It reads “go away”\. This removes this one message for everyone/,
    );
  });

  it("drops the quote when there is no text to quote", () => {
    expect(chatReportCopy.removeConfirm.description(null)).toMatch(
      /^This removes this one message for everyone/,
    );
  });

  it("tells the officer the sender will notice, and may identify the reporter in a DM", () => {
    // The trade-off accepted with report-scoped removal (#2311, option 1):
    // a 1:1 DM has one other reader, so removing a message there can reveal
    // who reported it. Said before the officer commits, not after.
    for (const content of ["go away", null]) {
      const description = chatReportCopy.removeConfirm.description(content);
      expect(description).toContain(
        "The sender will see this message was removed. In a direct message they may be able to tell who reported it.",
      );
      expect(description).toMatch(/This cannot be undone\.$/);
    }
  });
});
