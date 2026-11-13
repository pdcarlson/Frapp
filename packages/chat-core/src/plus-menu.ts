import { MODULE_CATALOG } from "@repo/org-archetypes";
import { canAll, EVENT_CREATE_PERMISSIONS } from "@repo/validation";
import { getSlashCommand } from "./integrations";

/**
 * The composer's **+** (#3865): one menu for everything a message can carry
 * besides text. The attachment row (web's Attach a file, the phone's Photo),
 * then one row per command that has a visual form, each opening the same form
 * the bare slash command opens (#3773). Shawn's rule: every slash command also
 * has a button and a form.
 *
 * Web and the phone draw it differently (a dropdown, a bottom sheet) but offer,
 * grey and explain rows by this one model, so the two can't drift. What a row
 * does with the member's role, the chapter's modules and the moment follows
 * `spec/ui/design-system/README.md` §5, entitlement gating.
 */

/** Commands with a form the **+** can open, in the menu's order. */
export const PLUS_MENU_COMMANDS = [
  "poll",
  "signup",
  "form",
  "event",
  "task",
  "hours",
  "points",
] as const;
export type PlusMenuCommand = (typeof PLUS_MENU_COMMANDS)[number];

/** Each row's label, and the plural the footer names it by. */
const PLUS_MENU_ROW_COPY: Record<
  PlusMenuCommand,
  { label: string; noun: string }
> = {
  poll: { label: "Poll", noun: "polls" },
  signup: { label: "Sign-up sheet", noun: "sign-up sheets" },
  form: { label: "Form", noun: "forms" },
  event: { label: "Event", noun: "events" },
  task: { label: "Task", noun: "tasks" },
  hours: { label: "Service hours", noun: "service hours" },
  points: { label: "Points", noun: "points" },
};

/**
 * The grant each form needs. Four are their routes' guards: `POST /v1/events`
 * is `EVENT_CREATE_PERMISSIONS`; `POST /v1/tasks` is `tasks:manage` under the
 * controller's `members:view`; `POST /v1/service-entries` is `service:log`;
 * `POST /v1/points/adjust` is `points:adjust` under `members:view`. The task
 * and points forms also list members to pick from, which `members:view` reads.
 *
 * Poll is not: a poll card goes through the chat send route like a message,
 * which doesn't check `polls:create` (web's `/poll` posts for anyone), so this
 * is a client-side offer, the phone's rule since #3701. Whether the server
 * should enforce it is #3007's open decision.
 *
 * A sign-up sheet (#3926) needs nothing: anyone who can post in the channel
 * can post one, as they can a message. So does a form (#3926 step 3).
 */
export const PLUS_MENU_PERMISSIONS: Record<PlusMenuCommand, readonly string[]> =
  {
    poll: ["polls:create"],
    signup: [],
    form: [],
    event: EVENT_CREATE_PERMISSIONS,
    task: ["tasks:manage", "members:view"],
    hours: ["service:log"],
    points: ["points:adjust", "members:view"],
  };

/**
 * The `enabled_modules` key a command's form needs: its `SLASH_COMMANDS`
 * entry's. A sign-up sheet and a form have no slash command and no module.
 */
function rowModule(command: PlusMenuCommand): string | null {
  return getSlashCommand(command)?.requiredModule ?? null;
}

/**
 * The typed shortcut a row shows beside its label, or `null` for a form with
 * no slash command (a sign-up sheet, a form).
 */
export function plusMenuShortcut(command: PlusMenuCommand): string | null {
  return getSlashCommand(command) ? `/${command}` : null;
}

/** The forms that post through the outbox like a message, so work offline. */
const QUEUED_COMMANDS: ReadonlySet<PlusMenuCommand> = new Set([
  "poll",
  "signup",
  "form",
]);

/**
 * One form the host can open, and whether the member's role may use it:
 * `"loading"` while their permissions load, which hides the row without
 * blaming the role, and `"unknown"` when that read failed, which hides it and
 * says the role couldn't be checked (README.md §5: say so, don't just hide,
 * while the check can't be made).
 */
export interface PlusMenuForm {
  command: PlusMenuCommand;
  roleAllows: boolean | "loading" | "unknown";
}

/**
 * The forms a surface offers, each with its role check from
 * `PLUS_MENU_PERMISSIONS`. `granted` is the member's permission list, or
 * `undefined` while it hasn't been read; `failed` says that read failed.
 */
export function plusMenuForms(
  commands: readonly PlusMenuCommand[],
  granted: readonly string[] | undefined,
  failed: boolean,
): PlusMenuForm[] {
  return commands.map((command) => ({
    command,
    // A form that needs no grant (a sign-up sheet) waits on nothing.
    roleAllows:
      PLUS_MENU_PERMISSIONS[command].length === 0
        ? true
        : granted
          ? canAll(PLUS_MENU_PERMISSIONS[command], granted)
          : failed
            ? "unknown"
            : "loading",
  }));
}

/** Where the chapter's module read stands. */
export type PlusMenuModuleStatus = "loading" | "offline" | "error" | "ready";

export interface PlusMenuContext {
  forms: readonly PlusMenuForm[];
  moduleStatus: PlusMenuModuleStatus;
  /** Meaningful only when `moduleStatus` is `"ready"`. */
  isModuleEnabled: (moduleKey: string) => boolean;
  replying: boolean;
  /** What the attachment row stages: web's files, the phone's photos. */
  attachmentNoun: "file" | "photo";
  attachmentsStaged: number;
  attachmentLimit: number;
  offline: boolean;
  /**
   * What the member does when the permissions read failed: web's "Reload to
   * try again.", the phone's "Close this and try again."
   */
  roleRetryHint: string;
}

export interface PlusMenuRow {
  command: PlusMenuCommand;
  label: string;
  /** Why the row can't be used this second, shown beside it; else `null`. */
  disabledReason: string | null;
}

export interface PlusMenuModel {
  /** Why the attachment row can't take another one, or `null`. */
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
 *   this chapter's Settings."
 * - **It can't work this second:** shown greyed with the reason, the same
 *   refusals web's typed command gives (`slashRefusal` in `composer.tsx`):
 *   offline, an attachment staged, a reply staged. A poll queues like a
 *   message, so offline doesn't grey it. While the module read is still
 *   loading or failed, the row is greyed too rather than offered or hidden on
 *   a guess.
 */
export function plusMenuModel(ctx: PlusMenuContext): PlusMenuModel {
  const rows: PlusMenuRow[] = [];
  const roleHidden: string[] = [];
  const roleUnknown: string[] = [];
  const switchedOff: string[] = [];
  for (const command of PLUS_MENU_COMMANDS) {
    const form = ctx.forms.find((each) => each.command === command);
    if (!form || form.roleAllows === "loading") continue;
    const moduleKey = rowModule(command);
    if (
      moduleKey &&
      ctx.moduleStatus === "ready" &&
      !ctx.isModuleEnabled(moduleKey)
    ) {
      // No row's module is beta-off (`BETA_OFF_MODULES` is Dues alone), so
      // "turned off in Settings" is always the true reason here.
      switchedOff.push(moduleLabel(moduleKey));
      continue;
    }
    if (form.roleAllows === "unknown") {
      roleUnknown.push(PLUS_MENU_ROW_COPY[command].noun);
      continue;
    }
    if (!form.roleAllows) {
      roleHidden.push(PLUS_MENU_ROW_COPY[command].noun);
      continue;
    }
    rows.push({
      command,
      label: PLUS_MENU_ROW_COPY[command].label,
      disabledReason: rowDisabledReason(command, ctx),
    });
  }
  const footer: string[] = [];
  if (roleHidden.length > 0) {
    footer.push(`Your role can't create ${listNouns(roleHidden)}.`);
  }
  if (roleUnknown.length > 0) {
    footer.push(
      `Couldn't check whether your role can create ${listNouns(roleUnknown)}. ${ctx.roleRetryHint}`,
    );
  }
  if (switchedOff.length > 0) {
    footer.push(
      `${listLabels(switchedOff)} are turned off in this chapter's Settings.`,
    );
  }
  return {
    attachDisabledReason:
      ctx.attachmentsStaged >= ctx.attachmentLimit
        ? `Up to ${ctx.attachmentLimit} ${ctx.attachmentNoun}s`
        : null,
    rows,
    footer,
  };
}

function rowDisabledReason(
  command: PlusMenuCommand,
  ctx: PlusMenuContext,
): string | null {
  // A poll, a sign-up or a form goes through the outbox, so it works offline.
  if (ctx.offline && !QUEUED_COMMANDS.has(command)) return "Reconnect first";
  // The module read only holds back a form that needs a module.
  if (rowModule(command)) {
    if (ctx.moduleStatus === "offline") return "Reconnect first";
    if (ctx.moduleStatus === "loading") return "Still loading";
    if (ctx.moduleStatus === "error") return "Couldn't check Settings";
  }
  if (ctx.attachmentsStaged > 0) return `Send the ${ctx.attachmentNoun} first`;
  if (ctx.replying) return "Not while replying";
  return null;
}
