import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  chapterStore,
  navigation,
  settingsHooks,
  toastStub,
  type SettingsHooksOptions,
} from "./settings-harness";

const WEB = join(__dirname, "..");
/** Where a spec that renders the page can live. */
const ROOTS = ["components", "app"].map((dir) => join(WEB, dir));

/** Every spec file under `dir`, recursively. */
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(path);
    return /\.spec\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * An import of `settings-page`, dynamic or static, by its sibling path or its
 * alias: `import("./settings-page")`, `from "./settings-page"`, or either
 * with `@/components/settings/settings-page`.
 */
const IMPORTS_PAGE =
  /(?:import\(|from )\s*["'](?:\.\/|@\/components\/settings\/)settings-page["']/;

/** The specs that render the whole Settings page, named from `apps/web`. */
function pageSpecs(): [string, string][] {
  return ROOTS.flatMap(specFiles)
    .map((path): [string, string] => [
      relative(WEB, path),
      readFileSync(path, "utf8"),
    ])
    .filter(([, text]) => IMPORTS_PAGE.test(text));
}

/** Calls one stubbed hook by name, failing loudly if the harness lacks it. */
function hooksFrom(options: SettingsHooksOptions) {
  const hooks = settingsHooks(options);
  return <T = Record<string, unknown>>(name: string): T => {
    const hook = hooks[name];
    if (typeof hook !== "function") throw new Error(`no ${name} stub`);
    return hook() as T;
  };
}

const HARNESS = String.raw`async \(\) =>\s*\(await import\("@/tests/settings-harness"\)\)\.`;

/**
 * Each module every page spec stubs, and the harness factory that stubs it.
 *
 * `@/components/shared/can` is not here, so `canPassThrough` is not enforced:
 * `settings-rollover-promotion` mocks `Can` by hand on purpose, as a gate that
 * hides the promote toggle from a viewer without `roles:manage`, because that
 * gating is what it tests.
 */
const STUBS = [
  ["@repo/hooks", "settingsHooks"],
  ["@/lib/stores/chapter-store", "chapterStore"],
  ["next/navigation", "navigation"],
  ["@/lib/hooks/use-toast", "toastStub"],
] as const;

describe("Settings page spec harness", () => {
  // A page spec that hand-writes one of these stubs again drifts from the
  // baseline the others render against, which is how eight copies came to
  // exist in the first place.
  it("finds a page spec however it imports the page", () => {
    expect(
      [
        'await import("./settings-page")',
        'import { SettingsPage } from "./settings-page";',
        'import { SettingsPage } from "@/components/settings/settings-page";',
        'await import("@/components/settings/settings-page")',
      ].map((line) => IMPORTS_PAGE.test(line)),
    ).toEqual([true, true, true, true]);
    expect(
      [
        'from "./personal-settings-page"',
        "`settings-page.tsx` had five blocks",
        'from "./settings-page-header"',
      ].map((line) => IMPORTS_PAGE.test(line)),
    ).toEqual([false, false, false]);
  });

  it.each(STUBS)("every page spec stubs %s through %s", (module, factory) => {
    const specs = pageSpecs();
    // A scan of nothing passes forever.
    expect(specs.length).toBeGreaterThanOrEqual(8);
    const pattern = new RegExp(
      String.raw`vi\.mock\("${module.replace(/[/.]/g, "\\$&")}", ${HARNESS}${factory}\(`,
    );
    const drifted = specs
      .filter(([, text]) => !pattern.test(text))
      .map(([name]) => name);
    expect(drifted).toEqual([]);
  });

  it("stubs a server with AI off, so the page draws no AI row (#4308)", () => {
    const use = hooksFrom({
      currentChapter: () => null,
      permissions: () => [],
    });
    expect(use("useAiConsent")).toEqual({ data: null });
    expect(use<boolean>("aiAvailableFrom")).toBe(false);
    expect(use<boolean>("isFirstAiReadInFlight")).toBe(false);
  });

  it("reads the viewer, the chapter and the org config on every render", () => {
    let granted = ["*"];
    let archetype = "ifc";
    const use = hooksFrom({
      currentChapter: () => ({ data: { name: "Tau Nu" } }),
      permissions: () => granted,
      orgConfig: () => ({ org_archetype: archetype }),
    });
    granted = ["chapter-config:view"];
    archetype = "npc";
    expect(use("useMyPermissions").data).toEqual({
      permissions: ["chapter-config:view"],
    });
    expect(use("useCurrentChapter").data).toEqual({ name: "Tau Nu" });
    expect(use("useOrgConfig").data).toEqual({ org_archetype: "npc" });
  });

  it("defaults to an IFC chapter, loaded empty reads and idle mutations", () => {
    const use = hooksFrom({ currentChapter: () => null });
    expect(use("useMyPermissions").data).toEqual({ permissions: [] });
    expect(use("useOrgConfig").data).toEqual({ org_archetype: "ifc" });
    expect(use("useSemesters")).toEqual({
      data: [],
      isPending: false,
      isError: false,
    });
    expect(use("useUpdateChapter").isPending).toBe(false);
  });

  it("lets a spec replace one export and keeps the rest", () => {
    const upload = vi.fn();
    const use = hooksFrom({
      currentChapter: () => null,
      permissions: () => [],
      overrides: {
        useUploadChapterLogo: () => ({ mutateAsync: upload, isPending: false }),
      },
    });
    expect(use("useUploadChapterLogo").mutateAsync).toBe(upload);
    expect(use("useRemoveChapterLogo").mutateAsync).not.toBe(upload);
  });

  it("stubs the store, the query string and the toast", () => {
    let active: string | null = null;
    const store = chapterStore(() => active);
    active = "chap-2";
    expect(store.useChapterStore((s) => s.activeChapterId)).toBe("chap-2");
    expect(chapterStore().useChapterStore((s) => s.activeChapterId)).toBe(
      "chap-1",
    );
    expect(navigation().useSearchParams().toString()).toBe("");
    const toast = vi.fn();
    expect(toastStub(toast).useToast().toast).toBe(toast);
  });
});
