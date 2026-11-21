import { MODULE_CATALOG } from "@repo/org-archetypes";
import { canAll, isBetaOffModule } from "@repo/validation";

/**
 * Settings search: one list of every setting a member can change, with the
 * words people use for it, read by the search field on both settings pages
 * (web's Chapter settings and Settings, the phone's Chapter settings and
 * Settings) and by web's Find dialog and the phone's Search screen, which list
 * the matches as their Settings group (`find-results.ts`).
 *
 * **Why an index, not the rail.** Typing "donate" has to find the Donation link
 * field inside the Chapter page, and "rush" the Recruitment page, so the
 * search reads fields and their synonyms, not section names (Paul, 2026-11-19,
 * "like Vercel"). Vercel's, GitHub's and Slack's settings searches work the
 * same way: a hand-kept list of settings with keywords, matched on the
 * client, each opening its page scrolled to the field.
 *
 * **Only what the viewer can change.** Each entry names the permissions it
 * takes to change it (`requires`); one the viewer can't change is never
 * listed, so a member searching "roles" isn't sent to a page that only says
 * who can change it. `"president"` is the wildcard holder, who alone changes
 * the chapter's AI switches and hands on the presidency.
 *
 * **Where an entry opens is per platform.** `web` names the Chapter settings
 * row (`?tab=`) or the Settings section (`?section=`) and the element to
 * scroll to and light (`anchor`, a DOM id the page already carries). `phone`
 * names the phone screen and the row's anchor (`SettingAnchor` in
 * `apps/mobile/components/settings/setting-anchor.tsx`). An entry the phone
 * has no screen for is still listed there and opens the web dashboard, so
 * an officer who searches "dues" on the phone learns where it lives.
 *
 * Keep an entry's `label` in the words its page uses, so the result reads like
 * the field it lands on.
 */

export type SettingsArea = "chapter" | "personal";

export type SettingPhoneScreen =
  "/chapter-settings" | "/chapter-roles" | "/chapter-logs" | "/preferences";

export type SettingEntry = {
  /** Stable; it is the `?setting=` value a link carries. */
  id: string;
  label: string;
  area: SettingsArea;
  /** The rail row (web) it sits under, as the rail names it. */
  section: string;
  /** Other words for it: synonyms, what it does, what people call it. */
  keywords: readonly string[];
  /** Every one is needed to change it; `"president"` is the wildcard holder. */
  requires?: readonly string[] | "president";
  /** Listed only while this module is on (and not off for the beta). */
  module?: string;
  /** Listed only while this module isn't off for every chapter in the beta. */
  betaModule?: string;
  /** Listed only where the server has AI. */
  needsAi?: boolean;
  web?: {
    /** Chapter settings `?tab=`, or Settings `?section=`. */
    page: string;
    /** The DOM id to scroll to and light; without one, the tab opens at its top. */
    anchor?: string;
    /** More params the row needs, such as `tool=discord-import`. */
    params?: Readonly<Record<string, string>>;
  };
  phone?: { screen: SettingPhoneScreen; anchor?: string };
};

const CONFIG = ["chapter-config:view", "chapter-config:manage"] as const;

/** The search's words, the same on web and the phone. */
export const SETTINGS_SEARCH_COPY = {
  placeholder: "Search settings",
  none: "No settings match. Try another word.",
  /** Under a phone match that only the web dashboard changes. */
  onWeb: "Changed on the web dashboard.",
  browserFailed: "The web dashboard couldn't be opened. Try again in a moment.",
} as const;

/** Area names, as each page's title says them. */
export const SETTINGS_AREA_LABELS: Readonly<Record<SettingsArea, string>> = {
  chapter: "Chapter settings",
  personal: "Settings",
};

type ModuleWords = {
  key: string;
  label: string;
  keywords: readonly string[];
};

/** The module pages of Chapter settings, in rail order (`settings-modules.ts`). */
const MODULE_WORDS: readonly ModuleWords[] = [
  { key: "chat", label: "Chat", keywords: ["messages", "messaging"] },
  {
    key: "announcements",
    label: "Announcements",
    keywords: ["announce", "broadcast", "news", "officer posts"],
  },
  {
    key: "events",
    label: "Events",
    keywords: ["calendar", "rsvp", "attendance", "check in", "check-in"],
  },
  { key: "points", label: "Points", keywords: ["leaderboard", "ledger"] },
  {
    key: "hours",
    label: "Service hours",
    keywords: ["service", "study hours", "volunteer", "community service"],
  },
  {
    key: "geofences",
    label: "Study zones",
    keywords: ["geofence", "study", "library", "map"],
  },
  {
    key: "tasks",
    label: "Tasks",
    keywords: ["todo", "to do", "assignments", "chores"],
  },
  { key: "polls", label: "Polls", keywords: ["vote", "voting", "survey"] },
  {
    key: "meetings",
    label: "Meetings",
    keywords: ["minutes", "agenda", "notes", "chapter meeting"],
  },
  {
    key: "documents",
    label: "Documents",
    keywords: ["files", "bylaws", "drive", "docs", "forms"],
  },
  {
    key: "backwork",
    label: "Backwork",
    keywords: ["coursework", "tests", "exams", "old tests", "test bank"],
  },
  {
    key: "reports",
    label: "Reports",
    keywords: ["export", "csv", "spreadsheet"],
  },
  {
    key: "rush",
    label: "Recruitment",
    keywords: ["rush", "prospects", "pnm", "bids", "intake"],
  },
  {
    key: "dues",
    label: "Dues",
    keywords: ["payments", "fees", "money", "late fee", "payment plan"],
  },
];

const MODULE_SWITCH_WORDS = [
  "module",
  "turn on",
  "turn off",
  "enable",
  "disable",
  "who can",
  "permissions",
] as const;

const CHAPTER_ENTRIES: readonly SettingEntry[] = [
  // ---- Chapter --------------------------------------------------------
  {
    id: "chapter-name",
    label: "Chapter name",
    area: "chapter",
    section: "Chapter",
    keywords: ["name", "rename", "organization name", "fraternity", "sorority"],
    requires: CONFIG,
    web: { page: "org", anchor: "chapter-name" },
  },
  {
    id: "university",
    label: "University",
    area: "chapter",
    section: "Chapter",
    keywords: ["school", "college", "campus"],
    requires: CONFIG,
    web: { page: "org", anchor: "chapter-university" },
  },
  {
    id: "donation-link",
    label: "Donation link",
    area: "chapter",
    section: "Chapter",
    keywords: [
      "donate",
      "donations",
      "give",
      "giving",
      "fundraising",
      "philanthropy",
      "support the chapter",
    ],
    requires: CONFIG,
    web: { page: "org", anchor: "chapter-donation" },
  },
  {
    id: "logo",
    label: "Logo",
    area: "chapter",
    section: "Chapter",
    keywords: ["crest", "image", "picture", "icon", "emblem", "chapter mark"],
    requires: CONFIG,
    web: { page: "org", anchor: "settings-chapter-mark" },
  },
  {
    id: "short-name",
    label: "Short name",
    area: "chapter",
    section: "Chapter",
    keywords: ["nickname", "abbreviation", "chapter mark"],
    requires: CONFIG,
    web: { page: "org", anchor: "chapter-short-name" },
  },
  {
    id: "accent",
    label: "Accent color",
    area: "chapter",
    section: "Chapter",
    keywords: ["color", "colour", "theme", "brand", "branding", "tint"],
    requires: CONFIG,
    web: { page: "org", anchor: "settings-accent" },
    phone: { screen: "/chapter-settings", anchor: "accent" },
  },
  {
    // The chapter's default chat background is set from the phone's Chapter
    // settings and, on web, from a channel's menu, so only the phone lists it.
    id: "chat-background",
    label: "Chat background",
    area: "chapter",
    section: "Chapter",
    keywords: ["wallpaper", "background", "chat theme", "pattern"],
    requires: CONFIG,
    phone: { screen: "/chapter-settings", anchor: "chat-background" },
  },
  {
    id: "greek-letters",
    label: "Greek letters",
    area: "chapter",
    section: "Chapter",
    keywords: ["letters", "symbols"],
    requires: CONFIG,
    web: { page: "org", anchor: "greek-letters" },
  },
  {
    id: "designation",
    label: "Chapter designation",
    area: "chapter",
    section: "Chapter",
    keywords: ["chapter letters", "which chapter"],
    requires: CONFIG,
    web: { page: "org", anchor: "designation" },
  },
  {
    id: "school-short",
    label: "School (short)",
    area: "chapter",
    section: "Chapter",
    keywords: ["school abbreviation", "university short name"],
    requires: CONFIG,
    web: { page: "org", anchor: "school-short" },
  },
  {
    id: "founded-year",
    label: "Founded year",
    area: "chapter",
    section: "Chapter",
    keywords: ["founding", "founded", "established", "charter", "since"],
    requires: CONFIG,
    web: { page: "org", anchor: "founded-year" },
  },
  {
    id: "organization-type",
    label: "Organization type",
    area: "chapter",
    section: "Chapter",
    keywords: [
      "archetype",
      "fraternity",
      "sorority",
      "council",
      "nphc",
      "ifc",
      "panhellenic",
      "professional",
      "multicultural",
    ],
    requires: CONFIG,
    web: { page: "org", anchor: "settings-archetype" },
  },
  {
    id: "vocabulary",
    label: "Vocabulary",
    area: "chapter",
    section: "Chapter",
    keywords: ["words", "terms", "terminology", "naming", "language"],
    requires: CONFIG,
    web: { page: "org", anchor: "settings-vocabulary" },
  },
  {
    id: "vocab-recruitment",
    label: "Recruitment process",
    area: "chapter",
    section: "Chapter",
    keywords: ["rush", "intake", "vocabulary"],
    requires: CONFIG,
    web: { page: "org", anchor: "vocab-recruitment" },
  },
  {
    id: "vocab-pledge",
    label: "New member term",
    area: "chapter",
    section: "Chapter",
    keywords: [
      "pledge",
      "new member",
      "aspirant",
      "candidate",
      "associate member",
      "vocabulary",
    ],
    requires: CONFIG,
    web: { page: "org", anchor: "vocab-pledge" },
  },
  {
    id: "vocab-class",
    label: "Cohort label",
    area: "chapter",
    section: "Chapter",
    keywords: ["pledge class", "line", "class", "cohort", "vocabulary"],
    requires: CONFIG,
    web: { page: "org", anchor: "vocab-class" },
  },
  {
    id: "vocab-order",
    label: "Member order number",
    area: "chapter",
    section: "Chapter",
    keywords: [
      "roll number",
      "bond number",
      "order number",
      "badge number",
      "scroll number",
      "vocabulary",
    ],
    requires: CONFIG,
    web: { page: "org", anchor: "vocab-order" },
  },
  {
    id: "vocab-tier",
    label: "Role tier",
    area: "chapter",
    section: "Chapter",
    keywords: ["tier", "rank", "officer level", "vocabulary"],
    requires: CONFIG,
    web: { page: "org", anchor: "vocab-tier" },
  },
  {
    id: "birthday-posts",
    label: "Birthday posts",
    area: "chapter",
    section: "Chapter",
    keywords: ["birthday", "birthdays", "celebrate", "birthday channel"],
    requires: CONFIG,
    web: { page: "org", anchor: "birthday-channel" },
  },

  // ---- Semester, Privacy, AI, Plan and billing --------------------------
  {
    id: "new-semester",
    label: "Start a new semester",
    area: "chapter",
    section: "Semester",
    keywords: [
      "rollover",
      "new term",
      "new year",
      "end semester",
      "archive semester",
      "promote new members",
    ],
    // The rollover controller also carries `members:view` on its class.
    requires: ["members:view", "semester:rollover"],
    web: { page: "semester", anchor: "settings-start-a-new-semester" },
  },
  {
    id: "analytics",
    label: "Usage analytics",
    area: "chapter",
    section: "Privacy",
    keywords: ["analytics", "tracking", "telemetry", "privacy", "opt out"],
    requires: CONFIG,
    web: { page: "privacy", anchor: "settings-privacy" },
  },
  {
    // The record of officer changes (Paul, 2026-11-21), which was the
    // `#chapter-audit` channel. Read-only, so `requires` is what reading takes.
    id: "logs",
    label: "Logs",
    area: "chapter",
    section: "Logs",
    keywords: ["audit", "audit log", "history", "changes", "who changed"],
    requires: ["chapter-config:view", "members:view"],
    web: { page: "logs" },
    phone: { screen: "/chapter-logs" },
  },
  {
    id: "chapter-ai",
    label: "AI features",
    area: "chapter",
    section: "AI",
    keywords: [
      "ai",
      "ask frapp",
      "assistant",
      "meeting notes",
      "transcription",
      "nudges",
      "chat as a source",
    ],
    requires: "president",
    needsAi: true,
    web: { page: "ai" },
    phone: { screen: "/chapter-settings", anchor: "ai" },
  },
  {
    id: "plan",
    label: "Plan",
    area: "chapter",
    section: "Plan and billing",
    keywords: [
      "subscription",
      "upgrade",
      "pricing",
      "billing",
      "payment method",
      "card",
    ],
    // The Billing tab and its controller both need `billing:view` as well.
    requires: ["billing:view", "billing:manage"],
    web: { page: "billing", anchor: "plan-panel-heading" },
  },
  {
    id: "chapter-invoices",
    label: "Chapter invoices",
    area: "chapter",
    section: "Plan and billing",
    keywords: ["receipts", "billing history", "payments", "invoice"],
    // Viewing alone changes nothing there, and search lists what can change.
    requires: ["billing:view", "billing:manage"],
    // The list is drawn only while dues is on (off for the beta).
    betaModule: "dues",
    web: { page: "billing", anchor: "invoice-list-heading" },
  },
  {
    id: "cancel-chapter",
    label: "Cancel or close the chapter",
    area: "chapter",
    section: "Plan and billing",
    keywords: [
      "cancel subscription",
      "delete chapter",
      "shut down",
      "downgrade",
    ],
    requires: ["billing:view", "billing:manage"],
    web: { page: "billing", anchor: "plan-cancel-or-close" },
  },

  // ---- People -----------------------------------------------------------
  {
    id: "roles",
    label: "Roles",
    area: "chapter",
    section: "Roles and groups",
    keywords: [
      "role",
      "positions",
      "officers",
      "exec",
      "permissions",
      "access",
      "titles",
      "tiers",
      "who can",
    ],
    requires: ["roles:manage"],
    web: { page: "roles" },
    phone: { screen: "/chapter-roles" },
  },
  {
    id: "default-invite-role",
    label: "Default invite role",
    area: "chapter",
    section: "Roles and groups",
    keywords: [
      "invite",
      "new members join as",
      "joining role",
      "starting role",
    ],
    requires: CONFIG,
    web: { page: "roles", anchor: "default-invite-role" },
  },
  {
    id: "transfer-presidency",
    label: "Transfer presidency",
    area: "chapter",
    section: "Roles and groups",
    keywords: ["president", "hand over", "successor", "new president"],
    requires: "president",
    web: { page: "roles", anchor: "settings-transfer-presidency" },
  },
  {
    id: "groups",
    label: "Groups",
    area: "chapter",
    section: "Roles and groups",
    keywords: ["committees", "committee", "teams", "mention groups"],
    requires: ["groups:manage"],
    // One page with the roles since Paul's 2026-11-19 call, on both apps.
    web: { page: "roles", anchor: "settings-groups" },
    phone: { screen: "/chapter-roles" },
  },
  {
    id: "pledge-class",
    label: "Pledge class",
    area: "chapter",
    section: "Pledge class",
    keywords: [
      "line",
      "class",
      "new member class",
      "cohort",
      "order number",
      "roll number",
    ],
    requires: ["roles:manage"],
    web: { page: "classes", anchor: "settings-classes" },
  },
  {
    id: "member-fields",
    label: "Member fields",
    area: "chapter",
    section: "Member fields",
    keywords: [
      "custom fields",
      "profile fields",
      "directory fields",
      "questions",
      "member info",
      "major",
      "shirt size",
    ],
    requires: CONFIG,
    web: { page: "fields", anchor: "settings-custom-member-fields" },
  },

  // ---- One per module page, then what sits on them ----------------------
  ...MODULE_WORDS.map((module): SettingEntry => {
    // An always-on module (Chat, Announcements) has no switch to light or
    // turn off, so its page opens at the top and offers no switch words.
    const alwaysOn =
      MODULE_CATALOG.find((entry) => entry.key === module.key)?.alwaysOn ??
      false;
    return {
      id: `module-${module.key}`,
      label: module.label,
      area: "chapter",
      section: "Modules",
      keywords: alwaysOn
        ? module.keywords
        : [...module.keywords, ...MODULE_SWITCH_WORDS],
      requires: CONFIG,
      betaModule: module.key,
      web: alwaysOn
        ? { page: module.key }
        : { page: module.key, anchor: `settings-module-${module.key}-switch` },
    };
  }),
  {
    id: "channels",
    label: "Channels",
    area: "chapter",
    section: "Chat",
    keywords: [
      "chat admin",
      "create channel",
      "categories",
      "pins",
      "report queue",
      "moderation",
      "reported messages",
    ],
    requires: ["channels:manage"],
    web: { page: "chat" },
  },
  {
    id: "discord-import",
    label: "Discord import",
    area: "chapter",
    section: "Chat",
    keywords: ["discord", "import", "migrate", "history", "archive"],
    requires: ["channels:manage"],
    web: { page: "chat", params: { tool: "discord-import" } },
  },
  {
    id: "service-rules",
    label: "Service hours rules",
    area: "chapter",
    section: "Service hours",
    keywords: [
      "minutes per point",
      "hours to points",
      "rate",
      "approval",
      "approve",
      "receipt",
      "proof",
    ],
    requires: CONFIG,
    betaModule: "hours",
    web: { page: "hours", anchor: "settings-module-hours-rules" },
  },
  {
    id: "service-goals",
    label: "Service and study goals",
    area: "chapter",
    section: "Service hours",
    keywords: ["goal", "target", "requirement", "minimum", "quota"],
    requires: CONFIG,
    betaModule: "hours",
    web: { page: "hours", anchor: "settings-module-service-goals" },
  },
  {
    id: "study-zones",
    label: "Study zones",
    area: "chapter",
    section: "Study zones",
    keywords: ["geofence", "map", "library", "study area", "location"],
    requires: ["geofences:manage"],
    module: "geofences",
    web: { page: "geofences", anchor: "settings-module-geofences-zones" },
  },
  {
    id: "points-rules",
    label: "Points rules",
    area: "chapter",
    section: "Points",
    keywords: ["limits", "cap", "maximum", "max points", "daily limit"],
    requires: CONFIG,
    betaModule: "points",
    web: { page: "points", anchor: "settings-module-points-rules" },
  },
  {
    id: "points-goal",
    label: "Points goal",
    area: "chapter",
    section: "Points",
    keywords: ["goal", "target", "requirement", "minimum", "quota"],
    requires: CONFIG,
    betaModule: "points",
    web: { page: "points", anchor: "settings-module-points-goals" },
  },
  {
    id: "minutes-sections",
    label: "Sections in the minutes",
    area: "chapter",
    section: "Meetings",
    keywords: ["minutes template", "agenda", "officer reports", "minutes"],
    requires: CONFIG,
    // The template's write is refused while Meetings is off.
    module: "meetings",
    web: { page: "meetings", anchor: "settings-module-meetings-rules" },
  },
  {
    id: "export-reports",
    label: "Export reports",
    area: "chapter",
    section: "Reports",
    keywords: ["csv", "spreadsheet", "download", "attendance report"],
    requires: ["reports:export"],
    module: "reports",
    web: { page: "reports" },
  },
  {
    id: "dues-amounts",
    label: "Dues amounts",
    area: "chapter",
    section: "Dues",
    keywords: [
      "fees",
      "cost",
      "installments",
      "payment plan",
      "late fee",
      "grace period",
      "scholarship",
    ],
    requires: CONFIG,
    betaModule: "dues",
    web: { page: "dues", anchor: "settings-dues" },
  },
];

const PERSONAL_ENTRIES: readonly SettingEntry[] = [
  {
    // Web has no push switch: a browser asks for its own.
    id: "push",
    label: "Push notifications",
    area: "personal",
    section: "Notifications",
    keywords: ["notifications", "alerts", "notify", "sounds"],
    phone: { screen: "/preferences", anchor: "push" },
  },
  {
    id: "quiet-hours",
    label: "Quiet hours",
    area: "personal",
    section: "Notifications",
    keywords: ["do not disturb", "dnd", "sleep", "mute", "silence", "night"],
    web: { page: "notifications", anchor: "quiet-hours" },
    phone: { screen: "/preferences", anchor: "quiet-hours" },
  },
  {
    id: "chat-notifications",
    label: "Chat messages",
    area: "personal",
    section: "Chapter alerts",
    keywords: [
      "chat notifications",
      "mentions only",
      "all messages",
      "notify",
      "notification level",
    ],
    web: { page: "alerts", anchor: "chat-level-legend" },
    phone: { screen: "/preferences", anchor: "chat-messages" },
  },
  {
    id: "chapter-alerts",
    label: "Chapter alerts",
    area: "personal",
    section: "Chapter alerts",
    keywords: [
      "notifications",
      "event reminders",
      "task reminders",
      "alert types",
    ],
    web: { page: "alerts", anchor: "chapter-alerts" },
    phone: { screen: "/preferences", anchor: "chapter-alerts" },
  },
  {
    id: "chat-density",
    label: "Chat density",
    area: "personal",
    section: "Appearance and chat",
    keywords: ["compact", "cozy", "spacing", "layout", "dense", "appearance"],
    web: { page: "appearance", anchor: "chat-density" },
    phone: { screen: "/preferences", anchor: "chat-density" },
  },
  {
    id: "read-receipts",
    label: "Read receipts",
    area: "personal",
    section: "Appearance and chat",
    keywords: ["seen", "read status", "privacy"],
    web: { page: "appearance", anchor: "read-receipts" },
    phone: { screen: "/preferences", anchor: "read-receipts" },
  },
  {
    // The Activity card's switch sits only in the phone's Settings.
    id: "nudges",
    label: "Nudges on Activity",
    area: "personal",
    section: "Activity",
    keywords: ["nudges", "reminders", "activity card"],
    phone: { screen: "/preferences", anchor: "nudges" },
  },
  {
    id: "linked-apps",
    label: "Linked apps",
    area: "personal",
    section: "Linked apps",
    keywords: ["discord", "google", "connect", "integrations", "link account"],
    web: { page: "apps", anchor: "linked-apps" },
    phone: { screen: "/preferences", anchor: "linked-apps" },
  },
  {
    id: "calendar",
    label: "Calendar",
    area: "personal",
    section: "Calendar",
    keywords: [
      "google calendar",
      "subscribe",
      "ical",
      "sync",
      "calendar feed",
      "outlook",
      "apple calendar",
    ],
    web: { page: "calendar", anchor: "calendar" },
    // On the phone, Google Calendar and Calendar apps are Linked apps rows.
    phone: { screen: "/preferences", anchor: "linked-apps" },
  },
  {
    id: "frapp-ai",
    label: "Frapp AI",
    area: "personal",
    section: "AI",
    keywords: ["ai", "ask frapp", "assistant", "consent"],
    needsAi: true,
    web: { page: "ai", anchor: "ai" },
    phone: { screen: "/preferences", anchor: "ai" },
  },
  {
    id: "blocked-members",
    label: "Blocked members",
    area: "personal",
    section: "Blocked members",
    keywords: ["block", "unblock", "blocked users"],
    web: { page: "blocked", anchor: "blocked-members" },
    phone: { screen: "/preferences", anchor: "blocked" },
  },
  {
    id: "my-invoices",
    label: "My invoices",
    area: "personal",
    section: "My invoices",
    keywords: ["dues", "pay", "payments", "bills", "receipts"],
    betaModule: "dues",
    web: { page: "invoices", anchor: "my-invoices" },
  },
  {
    id: "sign-out",
    label: "Sign out",
    area: "personal",
    section: "Account",
    keywords: ["log out", "logout", "sign off"],
    web: { page: "account", anchor: "account" },
    phone: { screen: "/preferences", anchor: "sign-out" },
  },
  {
    id: "delete-account",
    label: "Delete account",
    area: "personal",
    section: "Account",
    keywords: ["remove account", "close account", "deactivate", "erase data"],
    web: { page: "account", anchor: "account" },
    phone: { screen: "/preferences", anchor: "delete-account" },
  },
];

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  ...CHAPTER_ENTRIES,
  ...PERSONAL_ENTRIES,
];

const BY_ID: ReadonlyMap<string, SettingEntry> = new Map(
  SETTINGS_INDEX.map((entry) => [entry.id, entry]),
);

export function settingEntryById(
  id: string | null | undefined,
): SettingEntry | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export type SettingsSearchContext = {
  /** The viewer's grants; nothing chapter-side is listed while unknown. */
  permissions: readonly string[] | null | undefined;
  /** Which platform is asking: web lists only what web can open. */
  platform: "web" | "phone";
  /** Whether the server has AI (`aiAvailableFrom`), `true` only. */
  aiAvailable?: boolean;
  /** A module's switch; undefined while unresolved, which lists nothing gated. */
  isModuleEnabled?: (moduleKey: string) => boolean;
  /** Only this area, for a page that searches its own settings. */
  area?: SettingsArea;
};

/** Whether this viewer could change it, on this platform or on the web. */
export function isSettingListed(
  entry: SettingEntry,
  ctx: SettingsSearchContext,
): boolean {
  if (ctx.area && entry.area !== ctx.area) return false;
  if (ctx.platform === "web" && !entry.web) return false;
  if (entry.needsAi && ctx.aiAvailable !== true) return false;
  if (entry.betaModule && isBetaOffModule(entry.betaModule)) return false;
  if (entry.module) {
    if (isBetaOffModule(entry.module)) return false;
    if (!ctx.isModuleEnabled?.(entry.module)) return false;
  }
  if (entry.requires === "president") {
    return !!ctx.permissions?.includes("*");
  }
  if (entry.requires) {
    return canAll(entry.requires, ctx.permissions);
  }
  return true;
}

/** Lower case, accents dropped, punctuation as spaces. */
export function normalizeSettingText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A plural and its singular match each other ("roles", "role"). */
function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/** At most one letter added, dropped, changed or swapped. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    // A swap of two neighbours.
    return (
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2)
    );
  }
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

/** How well one typed word fits one word of the entry; 0 for not at all. */
function wordScore(token: string, word: string): number {
  if (word === token || stem(word) === stem(token)) return 1;
  if (word.startsWith(token)) return 0.8;
  // A typo, once the word is long enough that one letter can't change it.
  if (token.length >= 5) {
    if (withinOneEdit(stem(token), stem(word))) return 0.6;
    if (
      word.length > token.length &&
      withinOneEdit(token, word.slice(0, token.length))
    ) {
      return 0.5;
    }
  }
  return 0;
}

type Haystack = { words: readonly string[]; weight: number };

function haystacksFor(entry: SettingEntry): Haystack[] {
  const split = (text: string) => normalizeSettingText(text).split(" ");
  return [
    { words: split(entry.label), weight: 3 },
    { words: entry.keywords.flatMap(split), weight: 2 },
    { words: split(entry.section), weight: 1 },
  ];
}

/** The entry's fit for the query, or 0 when a typed word matches nothing. */
export function scoreSetting(entry: SettingEntry, query: string): number {
  const needle = normalizeSettingText(query);
  if (!needle) return 0;
  const tokens = needle.split(" ");
  const haystacks = haystacksFor(entry);
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const { words, weight } of haystacks) {
      for (const word of words) {
        best = Math.max(best, wordScore(token, word) * weight);
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  const label = normalizeSettingText(entry.label);
  if (label === needle) total += 10;
  else if (label.startsWith(needle)) total += 5;
  else if (
    entry.keywords.some((keyword) => normalizeSettingText(keyword) === needle)
  ) {
    total += 3;
  }
  return total;
}

export type SettingMatch = {
  entry: SettingEntry;
  /** `"Chapter settings · Roles"`: where it lives, as the pages name it. */
  hint: string;
  /** False on the phone for a setting only the web dashboard changes. */
  opensHere: boolean;
};

export function settingHint(entry: SettingEntry): string {
  return `${SETTINGS_AREA_LABELS[entry.area]} · ${entry.section}`;
}

/**
 * The settings that match, best first, of those this viewer can change. Ties
 * keep the index's order, which is the pages' order.
 */
export function searchSettings(
  query: string,
  ctx: SettingsSearchContext,
  limit = 12,
): SettingMatch[] {
  if (!normalizeSettingText(query)) return [];
  return SETTINGS_INDEX.map((entry, index) => ({
    entry,
    index,
    score: isSettingListed(entry, ctx) ? scoreSetting(entry, query) : 0,
  }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => ({
      entry,
      hint: settingHint(entry),
      opensHere: ctx.platform === "web" ? !!entry.web : !!entry.phone,
    }));
}

/**
 * The dashboard address that opens a setting, lit: a path, so web can push it
 * and the phone can put its web origin in front.
 */
export function settingWebPath(entry: SettingEntry): string | null {
  if (!entry.web) return null;
  const params = new URLSearchParams();
  params.set(entry.area === "chapter" ? "tab" : "section", entry.web.page);
  for (const [key, value] of Object.entries(entry.web.params ?? {})) {
    params.set(key, value);
  }
  params.set("setting", entry.id);
  const path = entry.area === "chapter" ? "/settings" : "/preferences";
  return `${path}?${params.toString()}`;
}
