import { MODULE_CATALOG } from "@repo/org-archetypes";
import {
  PERMISSION_REGISTRY,
  isBetaOffModule,
  type PermissionDefinition,
} from "@repo/validation";

/**
 * The modules that have a page in Chapter settings (#4073), in rail order.
 *
 * Each one is a row in the rail's Modules group and opens one page: the
 * switch, the rules the chapter can really set, who can do what, and the
 * module's officer tool. The order is how often a chapter reaches for each,
 * not the catalog's order: chat and events first, recruitment and dues last.
 *
 * Not every `MODULE_CATALOG` entry is here. Members, the audit log and
 * Chapter settings itself are the chapter, not a module you switch; Billing
 * is Plan and billing. The catalog's prototype extras (Academics, Risk
 * Management, Lines and the rest) have no product behind them, so the
 * Modules tab's switches for them saved a value nothing read (#1760) and
 * they get no page.
 */
export type ModuleSettings = {
  /** `enabled_modules` key, and the rail row's `?tab=` value. */
  key: string;
  label: string;
  /** One line under the page title: what the module is for a member. */
  description: string;
  /** What switching it off takes away, said on the page while it is off. */
  offNote: string;
  /** Free modules are always on; the switch is drawn locked. */
  alwaysOn: boolean;
  tier: "free" | "paid";
};

type ModuleCopy = Pick<
  ModuleSettings,
  "key" | "label" | "description" | "offNote"
>;

const MODULE_COPY: readonly ModuleCopy[] = [
  {
    key: "chat",
    label: "Chat",
    description: "Channels and direct messages for the whole chapter.",
    offNote: "",
  },
  {
    key: "announcements",
    label: "Announcements",
    description: "Officer posts that reach every member, with a push.",
    offNote: "",
  },
  {
    key: "events",
    label: "Events",
    description:
      "The chapter calendar, RSVPs, required attendance and check-in.",
    offNote:
      "Members don't see Events in the sidebar or as a card in chat, and no new events can be made.",
  },
  {
    key: "points",
    label: "Points",
    description:
      "The points ledger and leaderboard: points from events, service and officers.",
    offNote:
      "Members don't see Points, and nothing earns points until it's back on.",
  },
  {
    key: "hours",
    label: "Service hours",
    description:
      "Members log service and study hours; officers approve service for points.",
    offNote:
      "Members don't see Service hours or Study hours, and no hours can be logged.",
  },
  {
    key: "geofences",
    label: "Study zones",
    description:
      "Places on the map where a study session counts, and what it earns.",
    offNote: "Study sessions can't start, and the Study zones tool is hidden.",
  },
  {
    key: "tasks",
    label: "Tasks",
    description: "Assign work to members and confirm it's done.",
    offNote:
      "Members don't see Tasks in the sidebar or as a card in chat, and no new tasks can be made.",
  },
  {
    key: "polls",
    label: "Polls",
    description: "Quick votes posted in a channel.",
    offNote: "No one can post a new poll in chat.",
  },
  {
    key: "meetings",
    label: "Meetings",
    description:
      "Minutes for chapter, exec and committee meetings, posted to the members each meeting invites.",
    offNote:
      "Members don't see Meetings in the sidebar, and no minutes can be started or posted. Minutes already written are kept.",
  },
  {
    key: "documents",
    label: "Documents",
    description: "The chapter's files: bylaws, minutes, forms.",
    offNote: "Members don't see Documents in the sidebar.",
  },
  {
    key: "backwork",
    label: "Backwork",
    description: "The chapter's library of past coursework.",
    offNote: "Members don't see Backwork in the sidebar.",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Exports of attendance, points, roster and service.",
    offNote: "The Reports tool is hidden and nothing can be exported.",
  },
  {
    key: "rush",
    label: "Recruitment",
    description: "Prospects, notes, votes and bids during recruitment.",
    offNote: "Members don't see Recruitment, and no prospect can be added.",
  },
  {
    key: "dues",
    label: "Dues",
    description: "Dues amounts, payment plans and late fees.",
    offNote: "Members aren't invoiced for dues.",
  },
];

/** Every module with a page, in rail order, catalog tier attached. */
export const MODULE_SETTINGS: readonly ModuleSettings[] = MODULE_COPY.flatMap(
  (copy) => {
    const entry = MODULE_CATALOG.find((m) => m.key === copy.key);
    if (!entry) return [];
    return [
      {
        ...copy,
        alwaysOn: entry.alwaysOn,
        tier: entry.tier === "paid" ? "paid" : "free",
      },
    ];
  },
);

const MODULE_SETTINGS_BY_KEY: ReadonlyMap<string, ModuleSettings> = new Map(
  MODULE_SETTINGS.map((module) => [module.key, module]),
);

export function moduleSettingsFor(key: string): ModuleSettings | undefined {
  return MODULE_SETTINGS_BY_KEY.get(key);
}

export function isModuleSettingsTab(tab: string): boolean {
  return MODULE_SETTINGS_BY_KEY.has(tab);
}

/**
 * Modules with a page this release. A module that is off for every chapter in
 * the beta (`BETA_OFF_MODULES`, Dues today) has none, the way the Dues tab
 * was hidden before it.
 */
export function shownModuleSettings(): readonly ModuleSettings[] {
  return MODULE_SETTINGS.filter((module) => !isBetaOffModule(module.key));
}

/**
 * The permissions that belong to a module, from the permission registry the
 * Roles page reads (#4069), so "who can" on a module page and the Roles page
 * name the same things in the same words.
 */
export function modulePermissions(
  moduleKey: string,
): readonly PermissionDefinition[] {
  return PERMISSION_REGISTRY.filter((entry) => entry.module === moduleKey);
}
