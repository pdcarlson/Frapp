import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Route-literal guard.
 *
 * `app.json` sets `experiments.typedRoutes: true`, which makes expo-router
 * generate a union of real routes into `.expo/types` and narrow `Href` to it.
 * That never happens in CI: `.expo/` and `expo-env.d.ts` are gitignored
 * (`apps/mobile/.gitignore`) and written only by `expo start`, while CI runs a
 * bare `tsc`. With the generated types absent, `Href` widens back to `string`
 * and every route literal in the app is unchecked — verified by handing `Href`
 * a nonexistent path and watching `tsc --noEmit` pass.
 *
 * So the "route strings are compile-checked against the file tree" guarantee in
 * spec/ui/mobile/navigation.md is not delivered by the compiler in the place it
 * matters. This suite delivers it instead, by doing the same comparison against
 * the real file tree at test time. It is deliberately static rather than a
 * render test: it is checking the shape of the route graph, not behavior.
 *
 * Added in S2 (#957), the slice that renamed or deleted every route at once.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "app");
const scanRoots = [appDir, here, path.join(here, "..", "components")];

function walk(dir: string): string[] {
  // The string form, matching `apps/api/.../dto-constraint-coverage.spec.ts`.
  // `withFileTypes` would be tidier but needs `Dirent.parentPath`, which only
  // exists from Node 20.12 — and `package.json` engines allows >=18, so a
  // contributor on 18 or 20.11 would get a TypeError at collection time and
  // lose both guards in this file. CI's floating Node 20 would never show it.
  // Directories are harmless here: every caller filters by file extension.
  return readdirSync(dir, { recursive: true })
    .map(String)
    .map((entry) => path.join(dir, entry));
}

function isRouteFile(file: string): boolean {
  const base = path.basename(file);
  return (
    file.endsWith(".tsx") &&
    base !== "_layout.tsx" &&
    // `+not-found` is expo-router's catch-all, not an addressable route.
    !base.startsWith("+") &&
    !base.includes(".spec.")
  );
}

/**
 * Every spelling expo-router accepts for one route file. A group segment
 * (`(tabs)`) may be written or omitted, and a trailing `index` is the parent
 * path itself.
 */
function hrefVariants(routeFile: string): string[] {
  const segments = path
    .relative(appDir, routeFile)
    .replace(/\.tsx$/, "")
    .split(path.sep);

  const withoutIndex =
    segments[segments.length - 1] === "index" ? segments.slice(0, -1) : segments;
  const withoutGroups = withoutIndex.filter((s) => !s.startsWith("("));

  return [`/${withoutIndex.join("/")}`, `/${withoutGroups.join("/")}`];
}

const routeFiles = walk(appDir).filter(isRouteFile);

const validHrefs = new Set(routeFiles.flatMap(hrefVariants));

const LITERAL_PATTERNS = [
  /asRoute\(\s*"([^"]+)"\s*\)/g,
  /href="([^"]+)"/g,
  // Object-property form. A role-gated row list is naturally written as
  // `[{ href: "/host-check-in", … }]`, which the JSX-attribute pattern misses.
  /href:\s*"([^"]+)"/g,
  /router\.(?:replace|push|navigate)\(\s*"([^"]+)"\s*\)/g,
  // Object form. A route that takes a param has to be navigated as
  // `router.push({ pathname: "/chat-thread", params: { channelId } })`, which
  // every pattern above misses — the href is not a bare string literal at the
  // call site. Added with #937 C1, whose chat list is the first screen to
  // navigate with a param; without it the s04 → s05 link was invisible here.
  /pathname:\s*"([^"]+)"/g,
];

type Usage = { file: string; href: string };

function collectUsages(): Usage[] {
  const usages: Usage[] = [];

  // The three scan roots are disjoint siblings, so no dedupe is needed.
  for (const root of scanRoots) {
    for (const file of walk(root)) {
      if (!/\.tsx?$/.test(file) || file.includes(".spec.")) continue;

      const source = readFileSync(file, "utf8");
      for (const pattern of LITERAL_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          const href = match[1];
          // Only in-app paths are ours to resolve; external URLs and template
          // placeholders are somebody else's contract.
          if (!href.startsWith("/")) continue;
          usages.push({ file: path.relative(appDir, file), href });
        }
      }
    }
  }

  return usages;
}

describe("route literals", () => {
  it("finds route files to check against", () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  it("resolves every in-app route literal to a real route file", () => {
    const broken = collectUsages().filter(
      (usage) => !validHrefs.has(usage.href),
    );

    expect(
      broken,
      `Unresolvable route literals (the route file was renamed or deleted):\n${broken
        .map((b) => `  ${b.file} -> ${b.href}`)
        .join("\n")}\n\nKnown routes:\n  ${[...validHrefs].sort().join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * `frapp://event-details` is baked into every `.ics` file already exported to
   * a member's device calendar, so this filename is a contract with data we do
   * not control (spec/ui/mobile/navigation.md, screens.md).
   */
  it("keeps the event-details filename contract", () => {
    expect(validHrefs.has("/event-details")).toBe(true);
  });
});

describe("tab bar", () => {
  const layout = readFileSync(path.join(appDir, "(tabs)", "_layout.tsx"), "utf8");

  // Split on the element start rather than matching a whole element. The
  // previous pattern (`<Tabs.Screen\s+name="…"([\s\S]*?)/>`) required `name=` to
  // be the first prop and ended its options capture at the first `/>` — which is
  // the nested `<ChatGlyph />` on every visible tab. Either quirk dropped a
  // registration from this list entirely, and a dropped registration silently
  // passes the very check that exists to catch it.
  //
  // Splitting bounds each chunk at the next registration, so a chunk holds
  // exactly one `Tabs.Screen` plus the whitespace and comments trailing it —
  // no end-marker to guess at, and `name` may sit anywhere among the element's
  // own attributes.
  const registrations = layout
    .split("<Tabs.Screen")
    .slice(1)
    .map((options) => ({
      // Read `name` only from this element's own attributes — everything up to
      // the first nested tag. A `tabBarIcon` renders a glyph component, and
      // `<Ionicons name="home" />` inside one would otherwise be picked up as
      // the registration's name.
      name: /name="([^"]+)"/.exec(options.split("<")[0])?.[1],
      options,
    }))
    .filter((r): r is { name: string; options: string } => Boolean(r.name));

  it("registers exactly the four locked tabs as visible", () => {
    const visible = registrations
      .filter((r) => !/href:\s*null/.test(r.options))
      .map((r) => r.name);

    // spec/ui/mobile/navigation.md — 4 tabs, locked, in this order.
    expect(visible).toEqual(["index", "events", "tasks", "more"]);
  });

  it("backs every registration with a real route file", () => {
    const missing = registrations.filter(
      (r) => !routeFiles.some((f) => path.basename(f, ".tsx") === r.name),
    );

    // expo-router throws at runtime for a Tabs.Screen with no file, and the
    // pre-registered cluster routes are exactly the case that invites it.
    expect(missing.map((m) => m.name)).toEqual([]);
  });
});
