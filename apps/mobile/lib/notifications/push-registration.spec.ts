import { describe, expect, it } from "vitest";
import {
  isAlreadyRegistered,
  narrowPushTokenRow,
  parseStoredPushTokenRow,
} from "./push-registration";

describe("narrowPushTokenRow", () => {
  it("reads the row the API returns", () => {
    expect(
      narrowPushTokenRow({
        id: "row-1",
        user_id: "u1",
        token: "ExponentPushToken[abc]",
        device_name: null,
        created_at: "2026-08-18T00:00:00Z",
      }),
    ).toEqual({ id: "row-1", token: "ExponentPushToken[abc]" });
  });

  it("keeps the token when the id is missing, so push still works", () => {
    // `POST /v1/push-tokens` has no response schema, so this is a real
    // possibility rather than a defensive flourish. Losing the id costs a
    // deregistration, not the registration.
    expect(narrowPushTokenRow({ token: "ExponentPushToken[abc]" })).toEqual({
      id: null,
      token: "ExponentPushToken[abc]",
    });
  });

  it("is null without a token, which is the one field that matters", () => {
    expect(narrowPushTokenRow({ id: "row-1" })).toBeNull();
    expect(narrowPushTokenRow({ id: "row-1", token: "" })).toBeNull();
    expect(narrowPushTokenRow(null)).toBeNull();
    expect(narrowPushTokenRow("row")).toBeNull();
  });
});

describe("parseStoredPushTokenRow", () => {
  it("round-trips what was written", () => {
    const row = { id: "row-1", token: "ExponentPushToken[abc]" };
    expect(parseStoredPushTokenRow(JSON.stringify(row))).toEqual(row);
  });

  it("treats corrupt storage as absent rather than guessing", () => {
    expect(parseStoredPushTokenRow("{not json")).toBeNull();
    expect(parseStoredPushTokenRow(null)).toBeNull();
    expect(parseStoredPushTokenRow("")).toBeNull();
    expect(parseStoredPushTokenRow('{"id":"row-1"}')).toBeNull();
  });
});

describe("isAlreadyRegistered", () => {
  const token = "ExponentPushToken[abc]";

  it("skips a re-register only when the token matches and the id is known", () => {
    expect(isAlreadyRegistered({ id: "row-1", token }, token)).toBe(true);
  });

  it("re-registers when the device token has rotated", () => {
    expect(
      isAlreadyRegistered({ id: "row-1", token }, "ExponentPushToken[xyz]"),
    ).toBe(false);
  });

  it("re-registers when the id was never captured", () => {
    // Otherwise the row would be unreachable forever: no id means no DELETE,
    // and skipping the re-register means never getting one.
    expect(isAlreadyRegistered({ id: null, token }, token)).toBe(false);
  });

  it("registers when nothing is stored", () => {
    expect(isAlreadyRegistered(null, token)).toBe(false);
  });
});
