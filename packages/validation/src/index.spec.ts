import { describe, expect, it } from "vitest";

import {
  CustomFieldOptionsSchema,
  EmailInviteSchema,
  moduleDisabledMessage,
  moduleRefusalFromServerMessage,
  PatchChapterConfigSchema,
  SendChatMessageSchema,
} from "./index";

const UUID = "11111111-1111-4111-8111-111111111111";

/**
 * Runtime smoke for the Zod 4 APIs `@repo/validation` still uses. The
 * Dependabot 3 → 4 bump failed CI on `z.record`'s TypeScript arity
 * (`tsc` on `index.ts`); these cases do not catch that (specs are
 * excluded from the package `tsc`), but they would trip if `.uuid()`,
 * `.email()`, `.default()`, `.strict()`, or record *runtime* parsing
 * stopped matching the v3 shapes callers still send.
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
    });
  });

  it("applies the email string check", () => {
    expect(
      EmailInviteSchema.safeParse({
        role: "member",
        emails: ["member@example.com"],
      }).success,
    ).toBe(true);
    expect(
      EmailInviteSchema.safeParse({ role: "member", emails: ["not-an-email"] })
        .success,
    ).toBe(false);
  });

  it("rejects unknown keys on CustomFieldOptionsSchema", () => {
    expect(
      CustomFieldOptionsSchema.safeParse({ choices: ["A"], unexpected: 1 })
        .success,
    ).toBe(false);
  });
});

describe("moduleRefusalFromServerMessage", () => {
  it("names the module in the guard's own refusal", () => {
    expect(
      moduleRefusalFromServerMessage(moduleDisabledMessage("hours")),
    ).toEqual({
      moduleKey: "hours",
    });
    expect(
      moduleRefusalFromServerMessage(moduleDisabledMessage("geofences")),
    ).toEqual({ moduleKey: "geofences" });
  });

  it("is the sentence the guard has always sent, so shipped builds keep matching", () => {
    // Installed mobile builds match on this exact text. Rewording it is a
    // contract change for every binary already in members' hands.
    expect(moduleDisabledMessage("hours")).toBe(
      'The "hours" module is disabled for this chapter. Re-enable it in Settings → Modules to make changes.',
    );
  });

  it("does not claim any other 403 message", () => {
    for (const message of [
      "Alumni members cannot record study hours in this chapter",
      "Chapter subscription is not active; complete checkout to use this feature.",
      "Missing required permission",
      "",
      null,
      undefined,
    ]) {
      expect(moduleRefusalFromServerMessage(message)).toBeNull();
    }
  });

  it("matches the whole sentence, not a prefix or a suffix", () => {
    const full = moduleDisabledMessage("hours");
    expect(moduleRefusalFromServerMessage(full.slice(0, -1))).toBeNull();
    expect(moduleRefusalFromServerMessage(`${full} Extra.`)).toBeNull();
    expect(moduleRefusalFromServerMessage(full.slice(1))).toBeNull();
    expect(
      moduleRefusalFromServerMessage(moduleDisabledMessage("")),
    ).toBeNull();
  });
});
