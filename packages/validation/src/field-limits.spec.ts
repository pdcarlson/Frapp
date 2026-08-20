import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
} from "./field-limits";
import { RequestUploadUrlSchema, SendChatMessageSchema } from "./index";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("field-limits", () => {
  it("keeps the ledger and chat ceilings at the values DTOs advertise", () => {
    expect(POINTS_ADJUSTMENT_MAX).toBe(100_000);
    expect(POINTS_REASON_MAX_LENGTH).toBe(500);
    expect(CHAT_MESSAGE_CONTENT_MAX_LENGTH).toBe(10_000);
  });

  it("SendChatMessageSchema uses CHAT_MESSAGE_CONTENT_MAX_LENGTH, not a literal", () => {
    const base = {
      client_message_id: UUID,
      channel_id: UUID,
    };
    expect(
      SendChatMessageSchema.safeParse({
        ...base,
        content: "a".repeat(CHAT_MESSAGE_CONTENT_MAX_LENGTH),
      }).success,
    ).toBe(true);
    expect(
      SendChatMessageSchema.safeParse({
        ...base,
        content: "a".repeat(CHAT_MESSAGE_CONTENT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe("RequestUploadUrlSchema", () => {
  it("accepts a document-kind GIF", () => {
    expect(
      RequestUploadUrlSchema.safeParse({
        filename: "notes.gif",
        content_type: "image/gif",
      }).success,
    ).toBe(true);
  });

  it("rejects SVG and executables at the shared schema", () => {
    expect(
      RequestUploadUrlSchema.safeParse({
        filename: "logo.svg",
        content_type: "image/svg+xml",
      }).success,
    ).toBe(false);
    expect(
      RequestUploadUrlSchema.safeParse({
        filename: "payload.exe",
        content_type: "application/octet-stream",
      }).success,
    ).toBe(false);
  });
});
