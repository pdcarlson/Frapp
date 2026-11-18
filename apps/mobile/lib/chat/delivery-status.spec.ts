import { describe, expect, it } from "vitest";
import type { MessageStatus } from "@repo/chat-core/types";
import {
  deliveryChrome,
  RECORDED_NOTE,
  UNCONFIRMED_NOTE,
} from "./delivery-status";

/**
 * Completeness table for the union. Adding a `MessageStatus` member without
 * a key here is a compile error — same gate as `deliveryChrome`'s `never`
 * default, so a test file that forgot to mention the new status cannot stay
 * green while the helper "handles" it by omission.
 */
const STATUS_CASES: { [K in MessageStatus]: K } = {
  pending: "pending",
  confirmed: "confirmed",
  failed: "failed",
  unconfirmed: "unconfirmed",
  recorded: "recorded",
};

describe("deliveryChrome (#1910)", () => {
  it("classifies every MessageStatus as itself, never as confirmed-by-default", () => {
    for (const status of Object.values(STATUS_CASES)) {
      expect(deliveryChrome({ _status: status }).status).toBe(status);
    }
  });

  it("does not collapse unconfirmed into failed or confirmed", () => {
    const chrome = deliveryChrome({ _status: "unconfirmed" });
    expect(chrome).toEqual({ status: "unconfirmed", note: UNCONFIRMED_NOTE });
  });

  it("does not collapse recorded into unconfirmed, failed, or confirmed", () => {
    const chrome = deliveryChrome({ _status: "recorded" });
    expect(chrome).toEqual({ status: "recorded", note: RECORDED_NOTE });
  });

  it("prefers the row's _error over the fallback note", () => {
    expect(
      deliveryChrome({
        _status: "unconfirmed",
        _error: "Not confirmed — these points may or may not have been recorded.",
      }),
    ).toEqual({
      status: "unconfirmed",
      note: "Not confirmed — these points may or may not have been recorded.",
    });
    expect(
      deliveryChrome({
        _status: "recorded",
        _error:
          "Points recorded — the chat card didn't post. Don't run this command again.",
      }),
    ).toEqual({
      status: "recorded",
      note: "Points recorded — the chat card didn't post. Don't run this command again.",
    });
    expect(
      deliveryChrome({ _status: "failed", _error: "Network error" }),
    ).toEqual({ status: "failed", error: "Network error" });
  });

  it("uses Send failed when a failed row has no _error", () => {
    expect(deliveryChrome({ _status: "failed" })).toEqual({
      status: "failed",
      error: "Send failed",
    });
  });
});
