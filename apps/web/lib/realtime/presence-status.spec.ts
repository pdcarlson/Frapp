import { describe, expect, test } from "vitest";
import type { PresenceStatus } from "@repo/hooks/presence-status";
import { presenceStatusKind } from "./presence-status";

const ALL_STATUSES: PresenceStatus[] = [
  "online",
  "idle",
  "dnd",
  "invisible",
  "offline",
];

describe("presenceStatusKind", () => {
  test("no status is painted in the chapter accent", () => {
    for (const status of ALL_STATUSES) {
      const kind = presenceStatusKind(status);
      expect(kind, status).not.toMatch(/\b(bg|border|ring|text)-primary\b/);
      expect(kind, status).not.toMatch(/\baccent\b/);
    }
  });

  test("every status gets a treatment, and no two share one", () => {
    const kinds = ALL_STATUSES.map(presenceStatusKind);
    expect(kinds.every((k) => k.length > 0)).toBe(true);
    expect(new Set(kinds).size).toBe(ALL_STATUSES.length);
  });

  /**
   * `--success` and `--warning` are a green/amber pair, which is the classic
   * pair colour-vision deficiency collapses — so Online and Idle must differ in
   * shape too, not only in hue.
   */
  test("Idle is a ring and Online is a fill, so they differ without colour", () => {
    expect(presenceStatusKind("idle")).toContain("border-2");
    expect(presenceStatusKind("online")).not.toContain("border-2");
  });

  // Offline is a faint fill, so the viewer's own Invisible is a ring: they
  // can tell "I chose this" from "I'm disconnected".
  test("Invisible is a grey ring, apart from Offline's fill", () => {
    expect(presenceStatusKind("invisible")).toContain("border-2");
    expect(presenceStatusKind("invisible")).toContain("border-muted-foreground");
    expect(presenceStatusKind("offline")).not.toContain("border-2");
  });

  test("DND is the destructive fill", () => {
    expect(presenceStatusKind("dnd")).toBe("bg-destructive");
  });

  /**
   * The ring's interior sits over an avatar photo. `bg-transparent` would let
   * the photo through, so an amber-ish image would make Idle read as filled —
   * losing the shape distinction exactly where the colour one is weakest.
   */
  test("the Idle ring has an opaque interior", () => {
    expect(presenceStatusKind("idle")).toContain("bg-card");
    expect(presenceStatusKind("idle")).not.toContain("bg-transparent");
  });
});
