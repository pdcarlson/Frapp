import { describe, expect, it } from "vitest";

import {
  BackfillMessagesQuerySchema,
  ChatMessageActionSchema,
  CreateCheckoutSchema,
  CurrentChapterPayloadSchema,
  CustomFieldOptionsSchema,
  PatchChapterConfigSchema,
  SendChatMessageSchema,
} from "./index";

const UUID = "11111111-1111-4111-8111-111111111111";

/**
 * Runtime smoke for the Zod 4 APIs `@repo/validation` still uses. The
 * Dependabot 3 → 4 bump failed CI on `z.record`'s TypeScript arity
 * (`tsc` on `index.ts`); these cases do not catch that (specs are
 * excluded from the package `tsc`), but they would trip if `.uuid()`,
 * `.email()`, `.url()`, `.default()`, `.coerce`, `.passthrough()`,
 * `.strict()`, or record *runtime* parsing stopped matching the v3
 * shapes callers still send.
 */
describe("Zod 4 schema smoke", () => {
  describe("z.record(key, value)", () => {
    it("parses chapter config maps", () => {
      const parsed = PatchChapterConfigSchema.parse({
        enabled_modules: { events: true, chat: false },
        vocabulary: { member: "brother" },
      });
      expect(parsed.enabled_modules).toEqual({ events: true, chat: false });
      expect(parsed.vocabulary).toEqual({ member: "brother" });
    });

    it("treats omitted maps as optional", () => {
      expect(PatchChapterConfigSchema.parse({})).toEqual({});
    });

    it("rejects a non-object map", () => {
      expect(
        PatchChapterConfigSchema.safeParse({ enabled_modules: true }).success,
      ).toBe(false);
    });

    it("parses chat payload records", () => {
      const send = SendChatMessageSchema.parse({
        client_message_id: UUID,
        channel_id: UUID,
        content: "hello",
        payload: { option_id: "a", extra: 1 },
      });
      expect(send.kind).toBe("text");
      expect(send.payload).toEqual({ option_id: "a", extra: 1 });

      const action = ChatMessageActionSchema.parse({
        message_id: UUID,
        action_type: "vote",
        payload: { option_id: "a" },
      });
      expect(action.payload).toEqual({ option_id: "a" });
    });
  });

  it("accepts uuid / email / url string checks", () => {
    expect(
      CreateCheckoutSchema.parse({
        customer_email: "member@example.com",
        success_url: "https://example.com/ok",
        cancel_url: "https://example.com/cancel",
      }),
    ).toMatchObject({ customer_email: "member@example.com" });
  });

  it("coerces backfill limit from a query string", () => {
    expect(BackfillMessagesQuerySchema.parse({ limit: "10" })).toEqual({
      limit: 10,
    });
  });

  it("keeps unknown keys on CurrentChapterPayloadSchema", () => {
    const parsed = CurrentChapterPayloadSchema.parse({
      name: "Alpha",
      university: "State",
      subscription_status: "active",
      extra_from_api: true,
    });
    expect(parsed.extra_from_api).toBe(true);
  });

  it("rejects unknown keys on CustomFieldOptionsSchema", () => {
    expect(
      CustomFieldOptionsSchema.safeParse({ choices: ["A"], unexpected: 1 })
        .success,
    ).toBe(false);
  });
});
