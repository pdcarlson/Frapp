import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  chapterStore,
  navigation,
  settingsHooks,
  toastStub,
  type SettingsHooksOptions,
} from "./settings-harness";

const SETTINGS = join(__dirname, "..", "components", "settings");

/** The specs that render the whole Settings page. */
function pageSpecs(): [string, string][] {
  return readdirSync(SETTINGS)
    .filter((name) => name.endsWith(".spec.tsx"))
    .map((name): [string, string] => [
      name,
      readFileSync(join(SETTINGS, name), "utf8"),
    ])
    .filter(([, text]) => text.includes('import("./settings-page")'));
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

/** Each module a page spec stubs, and the harness factory that stubs it. */
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
    const use = hooksFrom({
      currentChapter: () => null,
      permissions: () => [],
    });
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
