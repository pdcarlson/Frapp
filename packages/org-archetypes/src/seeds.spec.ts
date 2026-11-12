import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  CUSTOM_FIELDS_SEED,
  MODULE_CATALOG,
  VOCABULARY_DEFAULTS,
  WORKFLOWS_SEED,
  buildChapterConfigFromArchetype,
  getArchetype,
  getModuleCatalogEntry,
} from "./index";

// The API's specs mock this package (its dist is ESM-only under jest), so the
// guard helpers and the seed builder are tested here or nowhere.

describe("getArchetype", () => {
  it("returns the archetype for a known key", () => {
    for (const archetype of Object.values(ARCHETYPES)) {
      expect(getArchetype(archetype.key)).toBe(archetype);
    }
  });

  it("falls back to ifc for an unknown or empty key", () => {
    expect(getArchetype("not-an-archetype")).toBe(ARCHETYPES.ifc);
    expect(getArchetype("")).toBe(ARCHETYPES.ifc);
  });

  it("doesn't resolve inherited object keys", () => {
    expect(getArchetype("toString")).toBe(ARCHETYPES.ifc);
  });
});

describe("getModuleCatalogEntry", () => {
  it("returns the catalog entry for a known key", () => {
    for (const entry of MODULE_CATALOG) {
      expect(getModuleCatalogEntry(entry.key)).toBe(entry);
    }
  });

  it("falls back to the always-on chat entry for an unknown key", () => {
    const fallback = getModuleCatalogEntry("not-a-module");
    expect(fallback.key).toBe("chat");
    expect(fallback).toBe(MODULE_CATALOG[0]);
  });
});

describe("buildChapterConfigFromArchetype", () => {
  it("materializes the archetype's modules, vocabulary and seeds", () => {
    for (const archetype of Object.values(ARCHETYPES)) {
      const seed = buildChapterConfigFromArchetype(archetype.key);
      expect(seed.archetype).toBe(archetype.key);
      expect(seed.modules).toEqual(archetype.modules);
      expect(seed.vocabulary).toEqual(VOCABULARY_DEFAULTS[archetype.key]);
      expect(seed.customFields).toEqual(CUSTOM_FIELDS_SEED);
      expect(seed.workflows.map((w) => w.key)).toEqual(
        WORKFLOWS_SEED.map((w) => w.key),
      );
    }
  });

  it("sets the budget-approval threshold from the archetype and leaves the rest as seeded", () => {
    for (const archetype of Object.values(ARCHETYPES)) {
      const { workflows } = buildChapterConfigFromArchetype(archetype.key);
      for (const workflow of workflows) {
        const seeded = WORKFLOWS_SEED.find((w) => w.key === workflow.key)!;
        if (workflow.key === "wf_budget_approval") {
          expect(workflow.threshold).toBe(
            archetype.requirePresidentApprovalOnBudgetOver,
          );
          expect({ ...workflow, threshold: seeded.threshold }).toEqual(seeded);
        } else {
          expect(workflow).toEqual(seeded);
        }
      }
    }
  });

  it("falls back to the ifc seed for an unknown key", () => {
    expect(buildChapterConfigFromArchetype("not-an-archetype")).toEqual(
      buildChapterConfigFromArchetype("ifc"),
    );
  });

  it("returns copies, so editing a chapter's config can't change the shared seeds", () => {
    const ifcModules = { ...ARCHETYPES.ifc.modules };
    const ifcVocabulary = { ...VOCABULARY_DEFAULTS.ifc };
    const workflows = structuredClone(WORKFLOWS_SEED);
    const customFields = structuredClone(CUSTOM_FIELDS_SEED);

    const seed = buildChapterConfigFromArchetype("ifc");
    seed.modules.chat = !seed.modules.chat;
    (seed.vocabulary as unknown as Record<string, string>).pledge = "edited";
    seed.workflows[0]!.enabled = !seed.workflows[0]!.enabled;
    seed.customFields.push({ ...seed.customFields[0]! });

    expect(ARCHETYPES.ifc.modules).toEqual(ifcModules);
    expect(VOCABULARY_DEFAULTS.ifc).toEqual(ifcVocabulary);
    expect(WORKFLOWS_SEED).toEqual(workflows);
    expect(CUSTOM_FIELDS_SEED).toEqual(customFields);
    expect(buildChapterConfigFromArchetype("ifc")).toEqual(
      buildChapterConfigFromArchetype("ifc"),
    );
  });
});
