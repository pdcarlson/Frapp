import { describe, expect, it } from "vitest";
import {
  aiSwitchState,
  aiSwitchesInEffect,
  AI_SWITCHES,
  FRAPP_AI_COPY,
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
      "nudges",
    ]);
    const keys = new Set(AI_SWITCHES.map((entry) => entry.key));
    for (const entry of AI_SWITCHES) {
      if (entry.dependsOn) expect(keys.has(entry.dependsOn)).toBe(true);
    }
  });

  it("names the companies, the age Continue confirms and that it turns it on, in one line", () => {
    // Apple 5.1.2(i): Continue is an explicit yes only because the line
    // above it says who it works with and what Continue does.
    expect(FRAPP_AI_COPY.disclosure("Anthropic and Google")).toBe(
      "Frapp AI works with Anthropic and Google. Continuing confirms you're 18 or older and turns it on for your account.",
    );
  });

  it("keeps the screen to three short lines (Paul: say no more than needed)", () => {
    expect(FRAPP_AI_COPY.points).toHaveLength(3);
    for (const point of FRAPP_AI_COPY.points) {
      expect(point.text.length).toBeLessThanOrEqual(80);
    }
  });
});

describe("the chapter's AI switches (#4789)", () => {
  const channel = AI_SWITCHES.find((entry) => entry.key === "chat_source")!;

  it("holds Include channel messages off until Ask is on, but never on", () => {
    expect(aiSwitchState(channel, { ask: false })).toEqual({
      checked: false,
      parentOff: true,
      waitsOnParent: true,
    });
    expect(aiSwitchState(channel, { ask: false, chat_source: true })).toEqual({
      checked: true,
      parentOff: true,
      waitsOnParent: false,
    });
    expect(aiSwitchState(channel, { ask: true }).parentOff).toBe(false);
  });

  it("counts only the features that work", () => {
    expect(aiSwitchesInEffect(null)).toBe(0);
    expect(
      aiSwitchesInEffect({ ask: true, meeting_notes: true, chat_source: true }),
    ).toBe(3);
    expect(aiSwitchesInEffect({ ask: false, chat_source: true })).toBe(0);
  });
});
