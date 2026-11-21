import { describe, expect, it } from "vitest";
import { SETTINGS_INDEX } from "@repo/hooks/settings-search";
import { MODULE_SETTINGS } from "./settings-modules";

/**
 * The search index in `@repo/hooks` names each module page by hand, so this
 * holds it to the rail: a new or renamed module page fails here instead of
 * going missing from search.
 */
describe("settings search index against the module pages", () => {
  const indexed = SETTINGS_INDEX.filter((entry) =>
    entry.id.startsWith("module-"),
  );

  it("has one entry per module page, named as the rail names it", () => {
    expect(
      indexed.map((entry) => [entry.web?.page, entry.label]).sort(),
    ).toEqual(MODULE_SETTINGS.map((m) => [m.key, m.label]).sort());
  });

  it("anchors on the switch only where the page draws one", () => {
    for (const page of MODULE_SETTINGS) {
      const entry = indexed.find((e) => e.web?.page === page.key);
      expect(entry?.web?.anchor).toBe(
        page.alwaysOn ? undefined : `settings-module-${page.key}-switch`,
      );
    }
  });
});
