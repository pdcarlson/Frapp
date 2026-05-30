/**
 * @repo/org-archetypes
 *
 * TypeScript port of docs/internal/design-reference/org-config.jsx.
 * All seed exports are immutable (as const / Object.freeze at leaf level).
 * Any function that materializes per-chapter data from seeds must
 * structuredClone — never shallow-spread — so per-chapter edits cannot
 * mutate the shared reference.
 *
 * No window.* globals. ES module exports only. DOM-free: safe to import
 * from NestJS, Deno Edge Functions, and server-side rendering.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ArchetypeKey =
  | "ifc"
  | "npc"
  | "nphc"
  | "mgc"
  | "professional"
  | "service"
  | "honor"
  | "colony";

export type ModuleKey = string;

export type CustomFieldType =
  | "text"
  | "number"
  | "decimal"
  | "phone"
  | "select"
  | "boolean";

export type Visibility = "self" | "chapter" | "exec" | "president";

export interface SubFeature {
  readonly key: string;
  readonly label: string;
  readonly defaultOn: boolean;
}

export interface ModuleCatalogEntry {
  readonly key: ModuleKey;
  readonly label: string;
  readonly icon: string;
  /** "free" modules are always-on and cannot be disabled. */
  readonly tier: "free" | "paid";
  readonly alwaysOn: boolean;
  readonly description: string;
  readonly subFeatures: readonly SubFeature[];
}

export interface RoleEntry {
  readonly key: string;
  readonly label: string;
  readonly rank: number;
  readonly optional?: boolean;
}

export interface CustomFieldEntry {
  readonly id: string;
  readonly label: string;
  readonly type: CustomFieldType;
  readonly required: boolean;
  readonly visibleTo: Visibility;
  readonly sensitive?: boolean;
  readonly options?: readonly string[];
}

export interface WorkflowEntry {
  readonly key: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly threshold?: number;
  readonly units?: string;
}

export interface DuesConfigSeed {
  readonly cadence: "semester" | "monthly" | "annual";
  /** All monetary amounts are in cents to match the DB schema. */
  readonly active_amount_cents: number;
  readonly new_member_amount_cents: number;
  readonly alumni_amount_cents: number;
  readonly installments_allowed: boolean;
  readonly late_fee_cents: number;
  readonly grace_days: number;
  readonly scholarship_pool_cents: number;
}

export interface Archetype {
  readonly key: ArchetypeKey;
  readonly label: string;
  readonly short: string;
  readonly description: string;
  readonly council: string;
  readonly modules: Readonly<Record<string, boolean>>;
  readonly rolePack: string;
  readonly recruitmentLanguage: string;
  readonly pledgeLanguage: string;
  readonly classLanguage: string;
  readonly duesCadence: "semester" | "monthly" | "annual";
  readonly requirePresidentApprovalOnBudgetOver: number;
}

export interface VocabularyDefaults {
  readonly recruitment: string;
  readonly pledge: string;
  readonly class: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARCHETYPES
// ─────────────────────────────────────────────────────────────────────────────

export const ARCHETYPES = Object.freeze({
  ifc: Object.freeze({
    key: "ifc" as const,
    label: "IFC Fraternity",
    short: "IFC",
    description: "Traditional men's fraternity, NIC-affiliated. Rush, dues, risk, ritual.",
    council: "Interfraternity Council",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: true, hours: true, dues: true,
      polls: true, rush: true, backwork: true, documents: true, reports: true,
      onboarding: true, geofences: false,
      // prototype extras
      academics: true, philanthropy: true, risk: true,
      billing: true, lines: false, networking: false, standards: false,
      serviceFirst: false,
    }),
    rolePack: "ifc_standard",
    recruitmentLanguage: "Rush",
    pledgeLanguage: "New member",
    classLanguage: "Pledge class",
    duesCadence: "semester" as const,
    requirePresidentApprovalOnBudgetOver: 500,
  }),

  npc: Object.freeze({
    key: "npc" as const,
    label: "NPC Sorority",
    short: "NPC",
    description: "National Panhellenic Conference. Structured recruitment, standards, philanthropy-heavy.",
    council: "Panhellenic Council",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: true, hours: true, dues: true,
      polls: true, rush: true, backwork: true, documents: true, reports: true,
      onboarding: true, geofences: false,
      academics: true, philanthropy: true, risk: true,
      billing: true, lines: false, networking: false, standards: true,
      serviceFirst: false,
    }),
    rolePack: "npc_standard",
    recruitmentLanguage: "Recruitment",
    pledgeLanguage: "New member",
    classLanguage: "New member class",
    duesCadence: "semester" as const,
    requirePresidentApprovalOnBudgetOver: 250,
  }),

  nphc: Object.freeze({
    key: "nphc" as const,
    label: "NPHC / Divine Nine",
    short: "NPHC",
    description: "Historically Black Greek-letter organization. Smaller chapters, line-based, ritual-rich.",
    council: "National Pan-Hellenic Council",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: false, hours: true, dues: true,
      polls: false, rush: false, backwork: true, documents: true, reports: true,
      onboarding: true, geofences: false,
      academics: false, philanthropy: true, risk: false,
      billing: true, lines: true, networking: false, standards: false,
      serviceFirst: false,
    }),
    rolePack: "nphc_standard",
    recruitmentLanguage: "Intake",
    pledgeLanguage: "Aspirant",
    classLanguage: "Line",
    duesCadence: "annual" as const,
    requirePresidentApprovalOnBudgetOver: 100,
  }),

  mgc: Object.freeze({
    key: "mgc" as const,
    label: "Multicultural Greek",
    short: "MGC",
    description: "Multicultural Greek Council orgs — values-based, community-rooted.",
    council: "Multicultural Greek Council",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: true, hours: true, dues: true,
      polls: true, rush: false, backwork: true, documents: true, reports: true,
      onboarding: true, geofences: false,
      academics: true, philanthropy: true, risk: true,
      billing: true, lines: true, networking: false, standards: false,
      serviceFirst: false,
    }),
    rolePack: "ifc_standard",
    recruitmentLanguage: "Intake",
    pledgeLanguage: "New member",
    classLanguage: "Line",
    duesCadence: "semester" as const,
    requirePresidentApprovalOnBudgetOver: 300,
  }),

  professional: Object.freeze({
    key: "professional" as const,
    label: "Professional Fraternity",
    short: "Pro",
    description: "Business, law, engineering. Co-ed often. Networking-first.",
    council: "Professional Fraternity Association",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: true, hours: false, dues: true,
      polls: true, rush: true, backwork: true, documents: true, reports: true,
      onboarding: true, geofences: false,
      academics: true, philanthropy: false, risk: false,
      billing: true, lines: false, networking: true, standards: false,
      serviceFirst: false,
    }),
    rolePack: "professional",
    recruitmentLanguage: "Recruitment",
    pledgeLanguage: "Candidate",
    classLanguage: "Cohort",
    duesCadence: "semester" as const,
    requirePresidentApprovalOnBudgetOver: 250,
  }),

  service: Object.freeze({
    key: "service" as const,
    label: "Co-ed Service Fraternity",
    short: "Svc",
    description: "APO-style. Service hours are the spine of the org.",
    council: "Service Fraternity",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: false, hours: true, dues: true,
      polls: true, rush: true, backwork: true, documents: true, reports: true,
      onboarding: true, geofences: false,
      academics: false, philanthropy: true, risk: false,
      billing: true, lines: false, networking: false, standards: false,
      serviceFirst: true,
    }),
    rolePack: "service",
    recruitmentLanguage: "Rush",
    pledgeLanguage: "Pledge",
    classLanguage: "Pledge class",
    duesCadence: "semester" as const,
    requirePresidentApprovalOnBudgetOver: 150,
  }),

  honor: Object.freeze({
    key: "honor" as const,
    label: "Honor Society",
    short: "Honor",
    description: "Academic merit. Light operations, induction-driven.",
    council: "Association of College Honor Societies",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: false, points: false, hours: false, dues: true,
      polls: false, rush: false, backwork: true, documents: true, reports: false,
      onboarding: false, geofences: false,
      academics: true, philanthropy: false, risk: false,
      billing: true, lines: false, networking: false, standards: false,
      serviceFirst: false,
    }),
    rolePack: "honor",
    recruitmentLanguage: "Induction",
    pledgeLanguage: "Inductee",
    classLanguage: "Class",
    duesCadence: "annual" as const,
    requirePresidentApprovalOnBudgetOver: 100,
  }),

  colony: Object.freeze({
    key: "colony" as const,
    label: "Colony / Interest Group",
    short: "Colony",
    description: "Pre-chartered. Minimum viable ops while you build toward charter.",
    council: "—",
    modules: Object.freeze({
      chat: true, members: true, announcements: true, "audit-log": true,
      "chapter-settings": true,
      events: true, tasks: true, points: false, hours: false, dues: false,
      polls: false, rush: true, backwork: false, documents: false, reports: false,
      onboarding: false, geofences: false,
      academics: false, philanthropy: false, risk: false,
      billing: false, lines: false, networking: false, standards: false,
      serviceFirst: false,
    }),
    rolePack: "minimal",
    recruitmentLanguage: "Rush",
    pledgeLanguage: "Founding member",
    classLanguage: "Founding class",
    duesCadence: "semester" as const,
    requirePresidentApprovalOnBudgetOver: 0,
  }),
} satisfies Record<ArchetypeKey, Archetype>);

// ─────────────────────────────────────────────────────────────────────────────
// MODULE_CATALOG
// Master plan module keys + prototype-specific extras.
// tier:"free" + alwaysOn:true  → always enabled, cannot be toggled off.
// tier:"paid"                  → gates behind subscription; toggleable.
// ─────────────────────────────────────────────────────────────────────────────

export const MODULE_CATALOG: readonly ModuleCatalogEntry[] = Object.freeze([
  // ── Always-on (free tier) ────────────────────────────────────────────────
  {
    key: "chat", label: "Chat", icon: "message", tier: "free", alwaysOn: true,
    description: "Channels and DMs scoped to the chapter and committees.",
    subFeatures: Object.freeze([
      { key: "chat.channels",  label: "Channels",                   defaultOn: true },
      { key: "chat.dms",       label: "Direct messages",            defaultOn: true },
      { key: "chat.pins",      label: "Pinned messages",            defaultOn: true },
      { key: "chat.threads",   label: "Threaded replies",           defaultOn: true },
      { key: "chat.reactions", label: "Reactions",                  defaultOn: true },
      { key: "chat.broadcast", label: "President broadcast channel", defaultOn: true },
    ]),
  },
  {
    key: "members", label: "Members", icon: "users", tier: "free", alwaysOn: true,
    description: "Roster, profiles, contact info, custom fields.",
    subFeatures: Object.freeze([
      { key: "members.directory",    label: "Searchable directory",   defaultOn: true },
      { key: "members.customFields", label: "Custom member fields",   defaultOn: true },
      { key: "members.emergency",    label: "Emergency contacts",     defaultOn: true },
      { key: "members.alumni",       label: "Alumni status",          defaultOn: true },
    ]),
  },
  {
    key: "announcements", label: "Announcements", icon: "megaphone", tier: "free", alwaysOn: true,
    description: "Exec-write, member-read broadcast channel.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "audit-log", label: "Audit Log", icon: "shield", tier: "free", alwaysOn: true,
    description: "Member-visible record of all officer configuration changes.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "chapter-settings", label: "Chapter Settings", icon: "settings", tier: "free", alwaysOn: true,
    description: "Archetype, branding, theme, modules, roles, workflows, dues.",
    subFeatures: Object.freeze([]),
  },

  // ── Paid integrations ────────────────────────────────────────────────────
  {
    key: "events", label: "Events", icon: "calendar", tier: "paid", alwaysOn: false,
    description: "Calendar, RSVP, attendance scans, post-event points.",
    subFeatures: Object.freeze([
      { key: "events.rsvp",       label: "RSVP",                        defaultOn: true },
      { key: "events.qrCheckIn",  label: "QR check-in",                 defaultOn: true },
      { key: "events.geoCheckIn", label: "Geo-fenced check-in",         defaultOn: false },
      { key: "events.proxyVote",  label: "Proxy voting on chapter votes", defaultOn: true },
      { key: "events.postSurvey", label: "Post-event survey",           defaultOn: false },
      { key: "events.autoPoints", label: "Auto-grant points on attend",  defaultOn: true },
    ]),
  },
  {
    key: "tasks", label: "Tasks", icon: "check", tier: "paid", alwaysOn: false,
    description: "Assignments, confirmations, points-on-completion.",
    subFeatures: Object.freeze([
      { key: "tasks.assign",     label: "Assign tasks",                    defaultOn: true },
      { key: "tasks.confirm",    label: "Require confirmation by assigner", defaultOn: true },
      { key: "tasks.photoProof", label: "Photo proof on completion",       defaultOn: false },
      { key: "tasks.recurring",  label: "Recurring tasks",                 defaultOn: true },
    ]),
  },
  {
    key: "points", label: "Points", icon: "star", tier: "paid", alwaysOn: false,
    description: "Earn/spend tracking for participation. Append-only ledger.",
    subFeatures: Object.freeze([
      { key: "points.adjust",      label: "Manual adjustments",             defaultOn: true },
      { key: "points.leaderboard", label: "Public leaderboard",             defaultOn: true },
      { key: "points.categories",  label: "Custom point categories",        defaultOn: true },
      { key: "points.minimum",     label: "Enforce point minimum per term", defaultOn: false },
    ]),
  },
  {
    key: "hours", label: "Service hours", icon: "clock", tier: "paid", alwaysOn: false,
    description: "Service/philanthropy time tracking with approval queue.",
    subFeatures: Object.freeze([
      { key: "hours.selfReport", label: "Self-reported submissions",        defaultOn: true },
      { key: "hours.approval",   label: "Approval queue",                  defaultOn: true },
      { key: "hours.receipt",    label: "Require photo / signed slip",      defaultOn: true },
      { key: "hours.minimum",    label: "Enforce hour minimum per term",    defaultOn: true },
    ]),
  },
  {
    key: "dues", label: "Dues", icon: "card", tier: "paid", alwaysOn: false,
    description: "Dues, invoices, payment plans, scholarships.",
    subFeatures: Object.freeze([
      { key: "dues.plans",       label: "Payment plans",       defaultOn: true },
      { key: "dues.late",        label: "Late fees",           defaultOn: false },
      { key: "dues.scholarship", label: "Scholarship adjustments", defaultOn: true },
      { key: "dues.ach",         label: "ACH (no card fees)",  defaultOn: true },
      { key: "dues.card",        label: "Card payments",       defaultOn: true },
      { key: "dues.parent",      label: "Parent-pay portal",   defaultOn: false },
    ]),
  },
  {
    key: "polls", label: "Polls", icon: "poll", tier: "paid", alwaysOn: false,
    description: "Lightweight chapter votes, anonymous or named.",
    subFeatures: Object.freeze([
      { key: "polls.anonymous", label: "Anonymous mode",     defaultOn: true },
      { key: "polls.quorum",    label: "Quorum enforcement", defaultOn: true },
    ]),
  },
  {
    key: "rush", label: "Recruitment", icon: "funnel", tier: "paid", alwaysOn: false,
    description: "Candidate funnel, voting, bid management.",
    subFeatures: Object.freeze([
      { key: "rush.funnel",    label: "Stage funnel",                  defaultOn: true },
      { key: "rush.scoring",   label: "Candidate scoring",             defaultOn: true },
      { key: "rush.voting",    label: "Anonymous vote at bid",         defaultOn: true },
      { key: "rush.referrals", label: "Member referrals tracked",      defaultOn: true },
    ]),
  },
  {
    key: "backwork", label: "Backwork", icon: "folder", tier: "paid", alwaysOn: false,
    description: "Chapter document library + academic archive.",
    subFeatures: Object.freeze([
      { key: "backwork.chapter",   label: "Chapter docs",                       defaultOn: true },
      { key: "backwork.academic",  label: "Academic archive (past exams etc.)",  defaultOn: true },
      { key: "backwork.redaction", label: "Redaction enforced on upload",        defaultOn: true },
      { key: "backwork.ratings",   label: "Resource ratings",                   defaultOn: true },
    ]),
  },
  {
    key: "documents", label: "Documents", icon: "file", tier: "paid", alwaysOn: false,
    description: "Chapter-level document storage (bylaws, policies, minutes).",
    subFeatures: Object.freeze([]),
  },
  {
    key: "reports", label: "Reports", icon: "chart", tier: "paid", alwaysOn: false,
    description: "Chapter health: attendance, dues, hours, retention.",
    subFeatures: Object.freeze([
      { key: "reports.exec",      label: "Exec dashboard",            defaultOn: true },
      { key: "reports.nationals", label: "Nationals export",          defaultOn: true },
      { key: "reports.advisor",   label: "Advisor digest (email)",    defaultOn: false },
    ]),
  },
  {
    key: "onboarding", label: "Onboarding", icon: "sparkles", tier: "paid", alwaysOn: false,
    description: "Structured pathway for new members through initiation.",
    subFeatures: Object.freeze([
      { key: "onboarding.pathway",  label: "Weekly pathway",           defaultOn: true },
      { key: "onboarding.bigLittle",label: "Big/Little pairing",       defaultOn: true },
      { key: "onboarding.quiz",     label: "History/values quiz",      defaultOn: true },
    ]),
  },
  {
    key: "geofences", label: "Geofences", icon: "map-pin", tier: "paid", alwaysOn: false,
    description: "Geo-fenced check-in zones for events and chapter house.",
    subFeatures: Object.freeze([]),
  },

  // ── Prototype extras (archetype-specific paid features) ──────────────────
  {
    key: "billing", label: "Billing", icon: "credit-card", tier: "paid", alwaysOn: false,
    description: "Legacy billing module key (existing infrastructure). Prefer 'dues' for new integrations.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "academics", label: "Academics", icon: "book", tier: "paid", alwaysOn: false,
    description: "GPA tracking, scholarship enforcement, academic standards.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "philanthropy", label: "Philanthropy", icon: "heart", tier: "paid", alwaysOn: false,
    description: "Charitable giving tracking and philanthropy event management.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "risk", label: "Risk Management", icon: "shield-check", tier: "paid", alwaysOn: false,
    description: "Risk management policies, incident reporting, compliance.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "lines", label: "Lines", icon: "users-2", tier: "paid", alwaysOn: false,
    description: "NPHC/MGC line tracking — cohort, crossing date, line name.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "networking", label: "Networking", icon: "link", tier: "paid", alwaysOn: false,
    description: "Alumni networking, career connections, job board.",
    subFeatures: Object.freeze([]),
  },
  {
    key: "standards", label: "Standards", icon: "gavel", tier: "paid", alwaysOn: false,
    description: "NPC standards committee reports (private to standards chair + president).",
    subFeatures: Object.freeze([]),
  },
  {
    key: "serviceFirst", label: "Service-first", icon: "hands-helping", tier: "paid", alwaysOn: false,
    description: "APO-style service-hours-first experience. Elevates hours module in nav.",
    subFeatures: Object.freeze([]),
  },
]);

// ─────────────────────────────────────────────────────────────────────────────
// ROLE_PACKS
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_PACKS = Object.freeze({
  ifc_standard: Object.freeze([
    { key: "president",  label: "President",           rank: 1 },
    { key: "vp",         label: "Vice President",      rank: 2 },
    { key: "treasurer",  label: "Treasurer",           rank: 3 },
    { key: "secretary",  label: "Secretary",           rank: 4 },
    { key: "risk",       label: "Risk Manager",        rank: 5, optional: true },
    { key: "rush_chair", label: "Rush Chair",          rank: 6, optional: true },
    { key: "philan",     label: "Philanthropy Chair",  rank: 7, optional: true },
    { key: "social",     label: "Social Chair",        rank: 8, optional: true },
    { key: "newmem_ed",  label: "New Member Educator", rank: 9, optional: true },
    { key: "member",     label: "Active Member",       rank: 10 },
    { key: "newmember",  label: "New Member",          rank: 11 },
  ] as const),

  npc_standard: Object.freeze([
    { key: "president",  label: "President",             rank: 1 },
    { key: "vp",         label: "Vice President",        rank: 2 },
    { key: "treasurer",  label: "Treasurer",             rank: 3 },
    { key: "secretary",  label: "Recording Secretary",   rank: 4 },
    { key: "standards",  label: "Standards Chair",       rank: 5 },
    { key: "rush_chair", label: "Recruitment Chair",     rank: 6 },
    { key: "philan",     label: "Philanthropy Chair",    rank: 7 },
    { key: "panhel",     label: "Panhellenic Delegate",  rank: 8 },
    { key: "newmem_ed",  label: "New Member Educator",   rank: 9 },
    { key: "member",     label: "Active Member",         rank: 10 },
    { key: "newmember",  label: "New Member",            rank: 11 },
  ] as const),

  nphc_standard: Object.freeze([
    { key: "president",  label: "Basileus / President",       rank: 1 },
    { key: "vp",         label: "Anti-Basileus / VP",         rank: 2 },
    { key: "treasurer",  label: "Tamiouchos / Treasurer",     rank: 3 },
    { key: "secretary",  label: "Grammateus / Secretary",     rank: 4 },
    { key: "member",     label: "Member",                     rank: 5 },
    { key: "aspirant",   label: "Aspirant",                   rank: 6 },
  ] as const),

  professional: Object.freeze([
    { key: "president", label: "President",              rank: 1 },
    { key: "vp_pro",    label: "VP of Professional Dev", rank: 2 },
    { key: "vp_mem",    label: "VP of Membership",       rank: 3 },
    { key: "treasurer", label: "Treasurer",              rank: 4 },
    { key: "secretary", label: "Secretary",              rank: 5 },
    { key: "member",    label: "Brother / Sister",       rank: 6 },
    { key: "candidate", label: "Candidate",              rank: 7 },
  ] as const),

  service: Object.freeze([
    { key: "president",  label: "President",         rank: 1 },
    { key: "vp_service", label: "VP of Service",     rank: 2 },
    { key: "vp_member",  label: "VP of Membership",  rank: 3 },
    { key: "treasurer",  label: "Treasurer",         rank: 4 },
    { key: "secretary",  label: "Secretary",         rank: 5 },
    { key: "member",     label: "Active Brother",    rank: 6 },
    { key: "pledge",     label: "Pledge",            rank: 7 },
  ] as const),

  honor: Object.freeze([
    { key: "president", label: "President",       rank: 1 },
    { key: "vp",        label: "Vice President",  rank: 2 },
    { key: "treasurer", label: "Treasurer",       rank: 3 },
    { key: "secretary", label: "Secretary",       rank: 4 },
    { key: "advisor",   label: "Faculty Advisor", rank: 5 },
    { key: "member",    label: "Inductee",        rank: 6 },
  ] as const),

  minimal: Object.freeze([
    { key: "president", label: "Founding President", rank: 1 },
    { key: "vp",        label: "Founding VP",        rank: 2 },
    { key: "treasurer", label: "Treasurer",          rank: 3 },
    { key: "member",    label: "Founding Member",    rank: 4 },
  ] as const),
} satisfies Record<string, readonly RoleEntry[]>);

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM_FIELDS_SEED
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_FIELDS_SEED: readonly CustomFieldEntry[] = Object.freeze([
  { id: "cf_1", label: "Major",                       type: "text",    required: true,  visibleTo: "chapter" },
  { id: "cf_2", label: "Graduation year",             type: "number",  required: true,  visibleTo: "chapter" },
  { id: "cf_3", label: "Allergies",                   type: "text",    required: false, visibleTo: "exec",      sensitive: true },
  { id: "cf_4", label: "T-shirt size",                type: "select",  required: false, visibleTo: "chapter",   options: Object.freeze(["XS","S","M","L","XL","XXL"]) },
  { id: "cf_5", label: "Dietary",                     type: "select",  required: false, visibleTo: "exec",      options: Object.freeze(["None","Vegetarian","Vegan","Kosher","Halal","GF"]) },
  { id: "cf_6", label: "Emergency contact (name)",    type: "text",    required: true,  visibleTo: "exec",      sensitive: true },
  { id: "cf_7", label: "Emergency contact (phone)",   type: "phone",   required: true,  visibleTo: "exec",      sensitive: true },
  { id: "cf_8", label: "Cumulative GPA",              type: "decimal", required: false, visibleTo: "president", sensitive: true },
]);

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOWS_SEED
// ─────────────────────────────────────────────────────────────────────────────

export const WORKFLOWS_SEED: readonly WorkflowEntry[] = Object.freeze([
  { key: "wf_budget_approval",  label: "President approval on budget items over threshold",       enabled: true,  threshold: 500, units: "USD" },
  { key: "wf_task_confirm",     label: "Task creator must confirm completion",                     enabled: true },
  { key: "wf_event_photo",      label: "Require photo proof for event attendance",                 enabled: false },
  { key: "wf_dues_grace",       label: "Dues grace period before late status",                     enabled: true,  threshold: 7, units: "days" },
  { key: "wf_hours_receipt",    label: "Service hours require receipt (photo or signature)",       enabled: true },
  { key: "wf_rush_anon_vote",   label: "Rush vote is anonymous (one click per active)",           enabled: true },
  { key: "wf_standards_private",label: "Standards reports are private to standards chair + president", enabled: true },
  { key: "wf_advisor_digest",   label: "Send chapter advisor a weekly digest email",               enabled: false },
  { key: "wf_nationals_export", label: "Auto-export monthly report to nationals",                  enabled: false },
]);

// ─────────────────────────────────────────────────────────────────────────────
// VOCABULARY_DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────

export const VOCABULARY_DEFAULTS: Readonly<Record<ArchetypeKey, VocabularyDefaults>> =
  Object.freeze(
    Object.fromEntries(
      (Object.keys(ARCHETYPES) as ArchetypeKey[]).map((key) => {
        const a = ARCHETYPES[key];
        return [
          key,
          Object.freeze({
            recruitment: a.recruitmentLanguage,
            pledge:      a.pledgeLanguage,
            class:       a.classLanguage,
          }),
        ];
      }),
    ) as Record<ArchetypeKey, VocabularyDefaults>,
  );

// ─────────────────────────────────────────────────────────────────────────────
// DUES_CONFIG_SEED
// Default dues configuration in cents (matches chapter_dues_config schema).
// ─────────────────────────────────────────────────────────────────────────────

export const DUES_CONFIG_SEED: Readonly<DuesConfigSeed> = Object.freeze({
  cadence:                  "semester",
  active_amount_cents:      85000,  // $850
  new_member_amount_cents:  42500,  // $425
  alumni_amount_cents:      0,
  installments_allowed:     true,
  late_fee_cents:           2500,   // $25
  grace_days:               7,
  scholarship_pool_cents:   120000, // $1 200
});

// ─────────────────────────────────────────────────────────────────────────────
// Guard helpers — always use these instead of bare subscripts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the archetype for `key`, falling back to `ifc` for unknown keys.
 * Never returns undefined.
 */
export function getArchetype(key: string): Archetype {
  return (ARCHETYPES as Record<string, Archetype>)[key] ?? ARCHETYPES.ifc;
}

/**
 * Returns the role pack array for `packKey`, falling back to ifc_standard.
 * Never returns undefined.
 */
export function getRolePack(packKey: string): readonly RoleEntry[] {
  return (ROLE_PACKS as Record<string, readonly RoleEntry[]>)[packKey] ?? ROLE_PACKS.ifc_standard;
}

/**
 * Returns the MODULE_CATALOG entry for `key`, falling back to the "chat"
 * (always-on) entry so callers always get a valid object.
 * Never returns undefined.
 */
export function getModuleCatalogEntry(key: string): ModuleCatalogEntry {
  const entry = MODULE_CATALOG.find((m) => m.key === key);
  // Safe fallback: chat is always-on and always present
  return entry ?? MODULE_CATALOG[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildChapterConfigFromArchetype
// Deep-clones seeds so per-chapter edits never mutate the shared reference.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChapterConfigSeed {
  archetype: ArchetypeKey;
  modules: Record<string, boolean>;
  rolePack: string;
  vocabulary: VocabularyDefaults;
  customFields: CustomFieldEntry[];
  workflows: WorkflowEntry[];
  dues: DuesConfigSeed;
}

/**
 * Materializes a fresh chapter config from archetype seed data.
 * Uses structuredClone so mutations to the returned object cannot affect
 * the shared ARCHETYPES / seed constants.
 */
export function buildChapterConfigFromArchetype(archetypeKey: string): ChapterConfigSeed {
  const archetype = getArchetype(archetypeKey);
  return {
    archetype: archetype.key,
    modules:      structuredClone({ ...archetype.modules }),
    rolePack:     archetype.rolePack,
    vocabulary:   structuredClone(VOCABULARY_DEFAULTS[archetype.key]),
    customFields: structuredClone(CUSTOM_FIELDS_SEED as CustomFieldEntry[]),
    workflows:    structuredClone(WORKFLOWS_SEED as WorkflowEntry[]).map((w) => ({
      ...w,
      // Apply archetype-specific threshold overrides
      threshold: w.key === "wf_budget_approval"
        ? archetype.requirePresidentApprovalOnBudgetOver
        : w.threshold,
    })),
    dues: structuredClone({
      ...DUES_CONFIG_SEED,
      cadence: archetype.duesCadence,
    }),
  };
}
