"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ProfileSection } from "@/components/profile/profile-section";
import { type SettingsTool } from "@/components/settings/settings-access";
import { type ModuleSettings } from "@/components/settings/settings-modules";
import { SettingsToolList } from "@/components/settings/settings-tool-list";
import { ModuleWhoCan } from "@/components/settings/module-who-can";
import {
  moduleTierKind,
  moduleTierLabel,
} from "@/components/settings/settings-status";

type Props = {
  module: ModuleSettings;
  /** The resolved switch: the value `ChapterGuard` enforces (#3028). */
  on: boolean;
  /** Whether the viewer holds `chapter-config:manage`. */
  canManage: boolean;
  /** This module's `enabled_modules` leaf is saving. */
  switchPending?: boolean;
  onToggle: (enabled: boolean) => void;
  /** The tools this viewer holds that live on this page. */
  tools: readonly SettingsTool[];
  /** The module's stored rules, or nothing when it has none to set. */
  rules?: ReactNode;
  /** Whether the viewer can read roles (`members:view`) for "Who can". */
  canSeeWhoCan: boolean;
  /**
   * Focus the switch on mount: chat's ops-setup nudge (#492) lands an officer
   * here to turn the module on.
   */
  focusSwitch?: boolean;
  /** Called once focus landed, so the page latches the deep link. */
  onSwitchFocused?: (moduleKey: string) => void;
};

/**
 * One module's page in Chapter settings (#4073): the switch, the module's
 * tools, its rules, and who can do what in it, top to bottom.
 *
 * The order is the order an officer setting a module up goes in. Discord's
 * per-integration page and Slack's app configuration both open on the
 * on/off state, then what the thing does, then who may use it; here the
 * officer tool comes before the rules because it is the thing an officer
 * opens most (Chat admin, Study zones, Reports), and the rules are set once
 * a term.
 *
 * Everything shown is stored and read somewhere. A module with no rules has
 * no Rules block, rather than a disabled placeholder (#1760, #3439).
 */
export function ModuleSettingsPage({
  module,
  on,
  canManage,
  switchPending,
  onToggle,
  tools,
  rules,
  canSeeWhoCan,
  focusSwitch = false,
  onSwitchFocused,
}: Props) {
  const switchRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!focusSwitch) return;
    const control = switchRef.current;
    if (!control) return;
    // Focus, then center: a keyboard or screen-reader officer arriving from
    // the nudge lands on the control they were sent to, not on the body.
    control.focus({ preventScroll: true });
    control.scrollIntoView?.({ block: "center", behavior: "smooth" });
    onSwitchFocused?.(module.key);
  }, [focusSwitch, onSwitchFocused, module.key]);

  const switchId = `settings-module-${module.key}-switch`;

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title text-foreground">{module.label}</h2>
            <Badge variant={moduleTierKind(module.tier)}>
              {moduleTierLabel(module.tier)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{module.description}</p>
        </div>
        {module.alwaysOn ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 pt-1 text-sm text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Always on
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-3 pt-0.5">
            <label
              htmlFor={switchId}
              className="text-sm font-medium text-foreground"
            >
              {on ? "On" : "Off"}
            </label>
            <Switch
              id={switchId}
              ref={switchRef}
              checked={on}
              disabled={!canManage || switchPending}
              onCheckedChange={onToggle}
              aria-label={`${module.label} on`}
            />
          </div>
        )}
      </header>

      {!on ? (
        <p className="-mt-4 text-sm text-muted-foreground">
          {module.label} is off. {module.offNote} Turning it back on brings
          everything back; nothing was deleted. You can still set it up below.
        </p>
      ) : null}
      {!module.alwaysOn && !canManage ? (
        <p className="-mt-4 text-caption text-muted-foreground">
          Your role can&apos;t switch modules on or off.
        </p>
      ) : null}

      {tools.length > 0 ? (
        <ProfileSection
          id={`settings-module-${module.key}-tools`}
          title="Tools"
        >
          <SettingsToolList tools={tools} />
        </ProfileSection>
      ) : null}

      {rules}

      {canSeeWhoCan ? (
        <ModuleWhoCan moduleKey={module.key} moduleLabel={module.label} />
      ) : null}
    </div>
  );
}
