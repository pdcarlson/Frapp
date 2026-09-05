import { describe, expect, it } from "vitest";
import {
  isOpsNudgeModuleKey,
  OPS_NUDGE_MODULES,
  selectOpsNudge,
} from "./ops-nudges";

describe("OPS_NUDGE_MODULES", () => {
  // Pinned as an ordered list, not a set. `spec/product/modules.md` § "Ops-setup
  // nudges" states the priority as **Dues > Events > Tasks > Points** and
  // `selectOpsNudge` reads this array top-down, so a reorder here silently
  // changes documented behaviour with nothing else to catch it.
  it("is exactly the four spec'd modules, in the spec'd priority order", () => {
    expect(OPS_NUDGE_MODULES.map((m) => m.key)).toEqual([
      "dues",
      "events",
      "tasks",
      "points",
    ]);
  });

  // The nudge copy is the one place a module's *pitch* is written. The trial
  // language suggested in #492's context block was deliberately not adopted:
  // the 14-day trial is chapter-level and once-per-chapter (opened at Stripe
  // checkout, `spec/behavior/billing.md`), not per-module — per-module trial
  // state is #485 and unbuilt — so a "14-day trial" nudge would be false for
  // any chapter that has already held a subscription. This asserts the absence
  // so a later well-meaning copy edit has to read that reasoning first.
  it("promises no trial in any nudge copy", () => {
    for (const module of OPS_NUDGE_MODULES) {
      expect(`${module.headline} ${module.description}`).not.toMatch(/trial/i);
    }
  });

  it("gives every module non-empty copy", () => {
    for (const module of OPS_NUDGE_MODULES) {
      expect(module.headline.length).toBeGreaterThan(0);
      expect(module.description.length).toBeGreaterThan(0);
    }
  });

  // The module's display name is `MODULE_CATALOG`'s, resolved at the render
  // site through `getModuleCatalogEntry`. A `label` here would be a second copy
  // that drifts the moment the catalog is relabelled, leaving the nudge saying
  // "Enable Dues" while every other surface said something else. This package
  // cannot import `@repo/org-archetypes` (ESM-only dist — see the module
  // docblock), so `apps/web/components/chat/ops-setup-nudge.test.tsx` carries
  // the cross-check that every key here resolves to a real catalog entry.
  it("carries no label of its own", () => {
    for (const module of OPS_NUDGE_MODULES) {
      expect(module).not.toHaveProperty("label");
    }
  });
});

describe("isOpsNudgeModuleKey", () => {
  it("accepts the catalog's keys", () => {
    expect(isOpsNudgeModuleKey("dues")).toBe(true);
    expect(isOpsNudgeModuleKey("points")).toBe(true);
  });

  // `members.dismissed_ops_nudges` is an unconstrained `text[]`, so this guard
  // is the only thing standing between a client and a permanent junk entry.
  it("rejects anything else, including other real module keys", () => {
    expect(isOpsNudgeModuleKey("hours")).toBe(false);
    expect(isOpsNudgeModuleKey("chat")).toBe(false);
    expect(isOpsNudgeModuleKey("")).toBe(false);
    expect(isOpsNudgeModuleKey(null)).toBe(false);
    expect(isOpsNudgeModuleKey(undefined)).toBe(false);
    expect(isOpsNudgeModuleKey(42)).toBe(false);
  });
});

describe("selectOpsNudge", () => {
  it("offers the highest-priority disabled module", () => {
    expect(selectOpsNudge({ dues: false, points: false })?.key).toBe("dues");
    expect(selectOpsNudge({ tasks: false, points: false })?.key).toBe("tasks");
  });

  // The whole point of the priority order: never two at once.
  it("returns one module even when all four are disabled", () => {
    const nudge = selectOpsNudge({
      dues: false,
      events: false,
      tasks: false,
      points: false,
    });
    expect(nudge?.key).toBe("dues");
  });

  it("skips a dismissed module and offers the next one down", () => {
    expect(
      selectOpsNudge({ dues: false, events: false }, ["dues"])?.key,
    ).toBe("events");
    expect(selectOpsNudge({ dues: false, events: false }, ["dues", "events"]))
      .toBeNull();
  });

  // The load-bearing one. `enabled_modules[key] !== false` is the repo-wide
  // "enabled unless explicitly false" contract that `isModuleEnabled`, the
  // sidebar gate and Settings → Modules all read. Writing this predicate as
  // `!enabledModules[key]` — the obvious-looking version — would nudge every
  // chapter whose map simply has no entry for a module, which is every chapter
  // that never customised its archetype.
  it("treats a missing key as enabled, not as disabled", () => {
    expect(selectOpsNudge({})).toBeNull();
    expect(selectOpsNudge({ dues: true, events: true })).toBeNull();
    // Explicitly false is the only thing that qualifies.
    expect(selectOpsNudge({ dues: false })?.key).toBe("dues");
  });

  // A module the catalog does not nudge for must not become a nudge just by
  // being off — `hours`, `polls`, `rush` and the rest are all switchable.
  it("ignores disabled modules that have no nudge", () => {
    expect(selectOpsNudge({ hours: false, polls: false, rush: false })).toBeNull();
  });

  // Config in flight. Returning a nudge here would flash a card in and out on
  // every chat mount while `useOrgConfig` resolves.
  it("returns null while the chapter config is unresolved", () => {
    expect(selectOpsNudge(undefined)).toBeNull();
    expect(selectOpsNudge(undefined, ["dues"])).toBeNull();
  });

  it("defaults the dismissed list, so an older server's absent field is safe", () => {
    expect(selectOpsNudge({ dues: false })?.key).toBe("dues");
  });
});
