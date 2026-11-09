"use client";

import type { ComponentType } from "react";
import { isBetaOffModule } from "@repo/validation";
import { MODULE_CATALOG } from "@repo/org-archetypes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { ChapterModuleGateStatus } from "@/lib/hooks/use-chapter-module-gate";
import {
  AttachGlyph,
  EventsGlyph,
  PlusGlyph,
  PointsGlyph,
  PollsGlyph,
  ServiceGlyph,
  TasksGlyph,
  type ChatGlyphProps,
} from "./chat-glyphs";

/**
 * The composer's **+** (#3865, layout A): one menu for everything a message
 * can carry besides text. Attach a file, then one row per command that has a
 * visual form, each opening the same form the bare slash command opens
 * (#3773). Shawn's rule: every slash command also has a button and a form,
 * and typing `/` stays the shortcut, which each row teaches by showing it.
 *
 * What a row does with the member's role, the chapter's modules and the
 * moment follows `spec/ui/design-system/README.md` §5, entitlement gating (`plusMenuModel`).
 */

/** Commands with a form the **+** can open, in the menu's order. */
export const PLUS_MENU_COMMANDS = [
  "poll",
  "event",
  "task",
  "hours",
  "points",
] as const;
export type PlusMenuCommand = (typeof PLUS_MENU_COMMANDS)[number];

const ROW_COPY: Record<
  PlusMenuCommand,
  { label: string; noun: string; glyph: ComponentType<ChatGlyphProps> }
> = {
  poll: { label: "Poll", noun: "polls", glyph: PollsGlyph },
  event: { label: "Event", noun: "events", glyph: EventsGlyph },
  task: { label: "Task", noun: "tasks", glyph: TasksGlyph },
  hours: { label: "Service hours", noun: "service hours", glyph: ServiceGlyph },
  points: { label: "Points", noun: "points", glyph: PointsGlyph },
};

/** The `enabled_modules` key each command's form needs (`SLASH_COMMANDS`). */
const ROW_MODULE: Record<PlusMenuCommand, string> = {
  poll: "polls",
  event: "events",
  task: "tasks",
  hours: "hours",
  points: "points",
};

/**
 * One form the host can open, and whether the member's role may use it:
 * `null` while their permissions load, which hides the row without blaming
 * the role for it.
 */
export interface PlusMenuForm {
  command: PlusMenuCommand;
  roleAllows: boolean | null;
}

export interface PlusMenuContext {
  forms: readonly PlusMenuForm[];
  moduleStatus: ChapterModuleGateStatus;
  isModuleEnabled: (moduleKey: string) => boolean;
  replying: boolean;
  filesStaged: number;
  fileLimit: number;
  offline: boolean;
}

export interface PlusMenuRow {
  command: PlusMenuCommand;
  label: string;
  /** Why the row can't be used this second, shown beside it; else `null`. */
  disabledReason: string | null;
}

export interface PlusMenuModel {
  /** Why Attach a file can't be used right now, or `null`. */
  attachDisabledReason: string | null;
  rows: PlusMenuRow[];
  /** One line per kind of absence, each naming what is missing and why. */
  footer: string[];
}

function listNouns(nouns: string[]): string {
  if (nouns.length <= 1) return nouns.join("");
  return `${nouns.slice(0, -1).join(", ")} or ${nouns[nouns.length - 1]}`;
}

function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// Every module a row needs has a plural label ("Polls", "Service hours"),
// so the footer can always say "are".
function moduleLabel(key: string): string {
  return MODULE_CATALOG.find((entry) => entry.key === key)?.label ?? key;
}

/**
 * Which rows the menu shows, which are greyed and why, and the footer lines
 * that account for the rest (`spec/ui/design-system/README.md` §5):
 *
 * - **The role can't:** left out, and one line names what ("Your role can't
 *   create events or points."). The role, never a permission key.
 * - **The chapter turned it off:** left out, with "Polls are turned off in
 *   this chapter's Settings." (or "off for every chapter during the beta" for
 *   a module no chapter can switch on yet).
 * - **It can't work this second:** shown greyed with the reason, the same
 *   refusals the typed command gives (`slashRefusal` in `composer.tsx`):
 *   offline, a file staged, a reply staged. A poll queues like a message, so
 *   offline doesn't grey it. While the module read is still loading or
 *   failed, the row is greyed too rather than offered or hidden on a guess.
 */
export function plusMenuModel(ctx: PlusMenuContext): PlusMenuModel {
  const rows: PlusMenuRow[] = [];
  const roleHidden: string[] = [];
  const switchedOff: string[] = [];
  const betaOff: string[] = [];
  for (const command of PLUS_MENU_COMMANDS) {
    const form = ctx.forms.find((each) => each.command === command);
    if (!form || form.roleAllows === null) continue;
    const moduleKey = ROW_MODULE[command];
    if (ctx.moduleStatus === "ready" && !ctx.isModuleEnabled(moduleKey)) {
      (isBetaOffModule(moduleKey) ? betaOff : switchedOff).push(
        moduleLabel(moduleKey),
      );
      continue;
    }
    if (!form.roleAllows) {
      roleHidden.push(ROW_COPY[command].noun);
      continue;
    }
    rows.push({
      command,
      label: ROW_COPY[command].label,
      disabledReason: rowDisabledReason(command, ctx),
    });
  }
  const footer: string[] = [];
  if (roleHidden.length > 0) {
    footer.push(`Your role can't create ${listNouns(roleHidden)}.`);
  }
  if (switchedOff.length > 0) {
    footer.push(
      `${listLabels(switchedOff)} are turned off in this chapter's Settings.`,
    );
  }
  if (betaOff.length > 0) {
    footer.push(
      `${listLabels(betaOff)} are off for every chapter during the beta.`,
    );
  }
  return {
    attachDisabledReason:
      ctx.filesStaged >= ctx.fileLimit ? `Up to ${ctx.fileLimit} files` : null,
    rows,
    footer,
  };
}

function rowDisabledReason(
  command: PlusMenuCommand,
  ctx: PlusMenuContext,
): string | null {
  // A poll goes through the outbox, so it is the one form that works offline.
  if (ctx.offline && command !== "poll") return "Reconnect first";
  if (ctx.moduleStatus === "offline") return "Reconnect first";
  if (ctx.moduleStatus === "loading") return "Still loading";
  if (ctx.moduleStatus === "error") return "Couldn't check Settings";
  if (ctx.filesStaged > 0) return "Send the file first";
  if (ctx.replying) return "Not while replying";
  return null;
}

export interface ComposerPlusMenuProps {
  model: PlusMenuModel;
  /** Shared with the composer's other toolbar controls (32px, 44 to a finger). */
  triggerClassName: string;
  onAttach: () => void;
  onOpenForm: (command: PlusMenuCommand) => void;
}

/**
 * Always opens, even when Attach a file is all it holds, so the footer can say
 * why nothing else is there (#3865).
 */
export function ComposerPlusMenu({
  model,
  triggerClassName,
  onAttach,
  onOpenForm,
}: ComposerPlusMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label="Add a file, poll, event and more"
          title="Add"
        >
          <PlusGlyph className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-72">
        <DropdownMenuItem
          disabled={model.attachDisabledReason !== null}
          onSelect={onAttach}
        >
          <AttachGlyph className="h-4 w-4" />
          <span className="flex-1">Attach a file</span>
          {model.attachDisabledReason ? (
            <span className="text-xs">{model.attachDisabledReason}</span>
          ) : null}
        </DropdownMenuItem>
        {model.rows.length > 0 ? <DropdownMenuSeparator /> : null}
        {model.rows.map((row) => {
          const Glyph = ROW_COPY[row.command].glyph;
          return (
            <DropdownMenuItem
              key={row.command}
              disabled={row.disabledReason !== null}
              onSelect={() => onOpenForm(row.command)}
            >
              <Glyph className="h-4 w-4" />
              <span className="flex-1">{row.label}</span>
              {row.disabledReason ? (
                <span className="text-xs">{row.disabledReason}</span>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  /{row.command}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {model.footer.map((line) => (
          <p key={line} className="px-2 py-1 text-xs text-muted-foreground">
            {line}
          </p>
        ))}
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Tip: type <span className="font-mono">/</span> in the message box for
          shortcuts.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
