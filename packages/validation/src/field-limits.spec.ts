import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
  POINTS_REASON_MAX_LENGTH,
  SERVICE_DESCRIPTION_MAX_LENGTH,
} from "./field-limits";
import { SendChatMessageSchema } from "./index";
import {
  BLANK_NAME_REFUSAL,
  copyForServerMessage,
  tooLongRefusal,
  tooShortRefusal,
} from "./error-copy";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("field-limits", () => {
  it("keeps the ledger and chat ceilings at the values DTOs advertise", () => {
    expect(POINTS_ADJUSTMENT_MAX).toBe(100_000);
    expect(POINTS_REASON_MAX_LENGTH).toBe(500);
    expect(CHAT_MESSAGE_CONTENT_MAX_LENGTH).toBe(10_000);
  });

  it("keeps the service description ceiling at the value the DTO and s20 share", () => {
    // `CreateServiceEntryDto` refuses past it and the phone's s20 field caps
    // at it, so a change here moves both. Web's service dialog doesn't read
    // it yet (#3456).
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

/**
 * The API words a field's length refusal with these writers, and the member
 * reads it through `copyForServerMessage`: a refusal it can't read back would
 * reach a member as the caller's generic fallback.
 */
describe("field refusals", () => {
  it("words a length refusal with the limit as members read numbers", () => {
    expect(tooLongRefusal("the notes", 20_000)).toBe(
      "Keep the notes to 20,000 characters or fewer.",
    );
    expect(tooShortRefusal("the university", 2)).toBe(
      "Use at least 2 characters for the university.",
    );
  });

  it.each([
    tooLongRefusal("your name", 100),
    tooLongRefusal("your company", 200),
    tooLongRefusal("the chapter's name", 200),
    tooLongRefusal("the event's name", 255),
    tooLongRefusal("the location", 500),
    tooShortRefusal("the chapter's name", 3),
    BLANK_NAME_REFUSAL,
  ])("reads back %j as sent", (refusal) => {
    expect(copyForServerMessage(refusal)).toBe(refusal);
  });

  it("does not read a refusal it wasn't written for", () => {
    expect(copyForServerMessage("name must be shorter than 100")).toBeNull();
    expect(
      copyForServerMessage("Keep the connection open longer than 5 seconds."),
    ).toBeNull();
  });
});
