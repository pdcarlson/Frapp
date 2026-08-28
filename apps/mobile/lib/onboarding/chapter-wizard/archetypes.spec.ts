import { ARCHETYPES, getArchetype } from "@repo/org-archetypes";
import { describe, expect, it } from "vitest";

const WIZARD_KEYS = [
  "ifc",
  "npc",
  "nphc",
  "mgc",
  "professional",
  "service",
  "honor",
  "colony",
] as const;

describe("shared ARCHETYPES for the mobile first-officer wizard", () => {
  it("covers every wizard key exactly once, in catalog order", () => {
    expect(Object.keys(ARCHETYPES)).toEqual([...WIZARD_KEYS]);
  });

  it("falls back to ifc for unknown or empty values", () => {
    expect(getArchetype("nphc").key).toBe("nphc");
    expect(getArchetype("not-a-council").key).toBe("ifc");
    expect(getArchetype("").key).toBe("ifc");
  });

  it("keeps the labels, shorts, and councils the wizard paints", () => {
    expect(
      WIZARD_KEYS.map((key) => ({
        key,
        label: ARCHETYPES[key].label,
        short: ARCHETYPES[key].short,
        council: ARCHETYPES[key].council,
      })),
    ).toEqual([
      {
        key: "ifc",
        label: "IFC Fraternity",
        short: "IFC",
        council: "Interfraternity Council",
      },
      {
        key: "npc",
        label: "NPC Sorority",
        short: "NPC",
        council: "Panhellenic Council",
      },
      {
        key: "nphc",
        label: "NPHC / Divine Nine",
        short: "NPHC",
        council: "National Pan-Hellenic Council",
      },
      {
        key: "mgc",
        label: "Multicultural Greek",
        short: "MGC",
        council: "Multicultural Greek Council",
      },
      {
        key: "professional",
        label: "Professional Fraternity",
        short: "Pro",
        council: "Professional Fraternity Association",
      },
      {
        key: "service",
        label: "Co-ed Service Fraternity",
        short: "Svc",
        council: "Service Fraternity",
      },
      {
        key: "honor",
        label: "Honor Society",
        short: "Honor",
        council: "Association of College Honor Societies",
      },
      {
        key: "colony",
        label: "Colony / Interest Group",
        short: "Colony",
        council: "—",
      },
    ]);
  });
});
