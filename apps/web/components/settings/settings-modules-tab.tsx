"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import {
  MODULE_CATALOG,
  type ModuleCatalogEntry,
} from "@repo/org-archetypes";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import {
  moduleTierKind,
  moduleTierLabel,
} from "@/components/settings/settings-status";

type Props = {
  /** Merged `enabled_modules` map from the chapter config. */
  enabledModules: Record<string, boolean>;
  /** Whether the caller holds `chapter-config:manage`. */
  canManage: boolean;
  /** Persist a single module toggle through `usePatchOrgConfig`. */
  onToggle: (moduleKey: string, enabled: boolean) => void;
  /**
   * Config leaves currently saving, from `usePendingConfigKeys()`. Each switch
   * consults its own `enabled_modules.<key>` entry, so saving one module no
   * longer disables its siblings — or the other settings tabs (#881).
   */
  pendingModuleKeys?: ReadonlySet<string>;
  /**
   * Module row to scroll to and focus on mount, from `?module=` — how chat's
   * ops-setup nudge (#492) lands an officer on the module it named.
   */
  focusModuleKey?: string;
};

/**
 * A module is "on" unless explicitly set to `false` — the same semantics as
 * `useOrgConfig().isModuleEnabled`, so the tab, the sidebar gate, and the
 * slash-command palette all agree on a module's state.
 */
function moduleIsOn(
  enabledModules: Record<string, boolean>,
  key: string,
): boolean {
  return enabledModules[key] !== false;
}

const FREE_MODULES = MODULE_CATALOG.filter(
  (m) => m.alwaysOn || m.tier === "free",
);
const PAID_MODULES = MODULE_CATALOG.filter(
  (m) => !m.alwaysOn && m.tier === "paid",
);

/**
 * Settings → Modules. Toggles the chapter's enabled integrations. Always-on
 * (free) modules are locked; paid modules toggle `enabled_modules[key]`.
 * Disabling a module immediately removes its sidebar item (Chunk 06 nav gate)
 * and its slash commands (Chunk 05 palette filter), and mutes its system
 * channel — re-enabling restores everything; no data is deleted.
 */
export function SettingsModulesTab({
  enabledModules,
  canManage,
  onToggle,
  pendingModuleKeys,
  focusModuleKey,
}: Props) {
  const enabledCount = MODULE_CATALOG.filter((m) =>
    moduleIsOn(enabledModules, m.key),
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modules</CardTitle>
        <CardDescription>
          {enabledCount} of {MODULE_CATALOG.length} modules enabled. Disabling a
          module hides it from the sidebar and chat slash commands and mutes its
          system channel. Re-enabling restores everything — data is never
          deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <ModuleGroup
          title="Always on"
          modules={FREE_MODULES}
          enabledModules={enabledModules}
          canManage={canManage}
          onToggle={onToggle}
          pendingModuleKeys={pendingModuleKeys}
          focusModuleKey={focusModuleKey}
        />
        <ModuleGroup
          title="Chapter Pro"
          modules={PAID_MODULES}
          enabledModules={enabledModules}
          canManage={canManage}
          onToggle={onToggle}
          pendingModuleKeys={pendingModuleKeys}
          focusModuleKey={focusModuleKey}
        />
      </CardContent>
    </Card>
  );
}

function ModuleGroup({
  title,
  modules,
  enabledModules,
  canManage,
  onToggle,
  pendingModuleKeys,
  focusModuleKey,
}: {
  title: string;
  modules: readonly ModuleCatalogEntry[];
  enabledModules: Record<string, boolean>;
  canManage: boolean;
  onToggle: (moduleKey: string, enabled: boolean) => void;
  pendingModuleKeys?: ReadonlySet<string>;
  focusModuleKey?: string;
}) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {modules.map((m) => (
          <ModuleRow
            key={m.key}
            module={m}
            on={moduleIsOn(enabledModules, m.key)}
            canManage={canManage}
            onToggle={onToggle}
            pendingModuleKeys={pendingModuleKeys}
            shouldFocus={m.key === focusModuleKey}
          />
        ))}
      </ul>
    </section>
  );
}

function ModuleRow({
  module: m,
  on,
  canManage,
  onToggle,
  pendingModuleKeys,
  shouldFocus = false,
}: {
  module: ModuleCatalogEntry;
  on: boolean;
  canManage: boolean;
  onToggle: (moduleKey: string, enabled: boolean) => void;
  pendingModuleKeys?: ReadonlySet<string>;
  /** This is the row `?module=` named — scroll to it and focus its switch. */
  shouldFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasSubFeatures = m.subFeatures.length > 0;
  const locked = m.alwaysOn;

  const switchRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!shouldFocus) return;
    const control = switchRef.current;
    if (!control) return;
    /*
      Focus, not just scroll. A keyboard or screen-reader user arriving from
      the nudge would otherwise land with focus still on `document.body` and
      have to tab the whole rail to reach the row they were sent to.
      `focus({ preventScroll: true })` then `scrollIntoView("center")` rather
      than letting focus do the scrolling: the default focus scroll parks the
      row at whichever viewport edge is nearest, and a row flush against the
      top edge reads as the top of the list rather than as the row that was
      singled out.

      Runs once per mount. `shouldFocus` only flips when `?module=` changes,
      which is a fresh navigation, and a re-focus on any other re-render would
      steal focus from an officer who had already tabbed away.
    */
    control.focus({ preventScroll: true });
    control.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [shouldFocus]);

  return (
    <li>
      <div className="flex items-start gap-3 p-4">
        {hasSubFeatures ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-label={
              open
                ? `Collapse ${m.label} sub-features`
                : `Expand ${m.label} sub-features`
            }
            /*
              The last control in the family on the pre-cutover ring, missed
              because it is furniture rather than a field. It matters more than
              most: the button has no border, so `FOCUS_RING`'s load-bearing
              half — the border going solid accent — has nothing to swap, and
              the ring *is* the whole indicator. `FOCUS_RING_OFFSET` is the
              system's recipe for exactly that shape.

              This call site used to carry the residual: the offset ring cut §6
              3:1 failures from 8 seeds to 5, but not to 0, because the recipe
              drew in `--primary` (accent-9). #1215 fixed that in the primitive
              — it now draws in `--ring` (accent-8), which clears all 19 — so
              there is no residual left here. See `components/ui/focus.ts` and
              its `focus-contrast.test.ts` guard.
            */
            className={cn(
              "mt-0.5 rounded-xs text-muted-foreground transition-colors hover:text-foreground",
              FOCUS_RING_OFFSET,
            )}
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="mt-0.5 inline-block w-4" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{m.label}</span>
            {/*
              One badge, not a ternary between two hand-spelled tints. The
              accent half was §5's ban (#1202's defect, reached by a ternary
              this family had no mapper for) and the success half put a price
              tag in the status channel — a green `Free` beside an off switch
              said the module was on. `settings-status.ts` has the reasoning.
            */}
            <Badge variant={moduleTierKind(m.tier)}>
              {moduleTierLabel(m.tier)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
        </div>

        <div className="flex shrink-0 items-center">
          {locked ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden />
              Always on
            </span>
          ) : (
            <Switch
              ref={switchRef}
              checked={on}
              disabled={
                !canManage || pendingModuleKeys?.has(`enabled_modules.${m.key}`)
              }
              onCheckedChange={(next) => onToggle(m.key, next)}
              aria-label={`${m.label} enabled`}
            />
          )}
        </div>
      </div>

      {open && hasSubFeatures ? (
        /*
          No fill. `--secondary` aliases `--card` (`elevation-contrast.test.ts`
          pins it), so `bg-secondary/30` inside this card composited to
          1.000:1 — the strip it was meant to draw was never there. The
          hairline above it is the load-bearing edge (§2), and it already
          separates the expansion from the row; adding a step that cannot
          exist is what §10 means by a state that cannot rise above its
          container.
        */
        <div className="border-t border-border px-4 py-3 pl-11">
          <ul className="space-y-1.5">
            {m.subFeatures.map((sub) => (
              <li
                key={sub.key}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">{sub.label}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {sub.defaultOn ? "On by default" : "Off by default"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Per-feature toggles arrive with Settings customization (Chunk 07).
          </p>
        </div>
      ) : null}
    </li>
  );
}
