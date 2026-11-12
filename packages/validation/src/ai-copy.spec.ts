import { describe, expect, it } from "vitest";
import {
  AI_CONSENT_COPY,
  AI_SWITCHES,
  formatAiAnswerDate,
  joinNames,
} from "./ai-copy";

describe("AI copy", () => {
  it("joins provider names the way a sentence does", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Anthropic"])).toBe("Anthropic");
    expect(joinNames(["Anthropic", "Google"])).toBe("Anthropic and Google");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("writes a date out in full, never abbreviated", () => {
    // Midday UTC, so the day is the same in every time zone CI runs in.
    expect(formatAiAnswerDate("2026-11-12T12:00:00.000Z")).toBe(
      "November 12, 2026",
    );
    expect(formatAiAnswerDate("not a date")).toBe("");
  });

  it("has one switch per API switch, and a nested one only under a real switch", () => {
    // `AI_CHAPTER_SWITCHES` in apps/api/src/domain/constants/ai-consent-sheet.ts.
    expect(AI_SWITCHES.map((entry) => entry.key).sort()).toEqual([
      "ask",
      "chat_source",
      "meeting_notes",
    ]);
    const keys = new Set(AI_SWITCHES.map((entry) => entry.key));
    for (const entry of AI_SWITCHES) {
      if (entry.dependsOn) expect(keys.has(entry.dependsOn)).toBe(true);
    }
  });

  it("says what a No leaves in, not only what it keeps out", () => {
    // spec/behavior/ai.md § Consent: a No is not a promise that nothing
    // about the member reaches a model, and the sheet must say it that way.
    const text = AI_CONSENT_COPY.noMeans.join(" ");
    expect(text).toMatch(/can't use AI features/);
    expect(text).toMatch(/messages in channels are left out/);
    expect(text).toMatch(/minutes that name you/);
    expect(text).toMatch(/roster details/);
  });
});
