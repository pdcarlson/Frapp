import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  SERVICE_DESCRIPTION_MAX_LENGTH,
} from "./field-limits";
import { SendChatMessageSchema } from "./index";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("field-limits", () => {
  it("keeps the ledger and chat ceilings at the values DTOs advertise", () => {
    expect(POINTS_ADJUSTMENT_MAX).toBe(100_000);
    expect(POINTS_REASON_MAX_LENGTH).toBe(500);
    expect(CHAT_MESSAGE_CONTENT_MAX_LENGTH).toBe(10_000);
  });

  it("keeps the service description ceiling at the value the DTO and s20 share", () => {
    // `CreateServiceEntryDto` refuses past it and the phone's field caps at
    // it, so a change here moves both, and every client's limit with them.
    expect(SERVICE_DESCRIPTION_MAX_LENGTH).toBe(2_000);
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
