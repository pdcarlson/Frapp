/* Frapp — org configuration layer
   Per-org customization: archetypes, modules, sub-features, custom roles,
   custom fields, workflows, dues schemes. Single source of truth:
   window.ORG_CONFIG. The sidebar reads this for module gating; the Settings
   hub writes to it. */

/* ──────────────────────────────────────────────────────────────
   Archetypes — sensible presets per Greek-life type.
   Each defines: modules enabled, role vocabulary, recruitment style,
   dues style, and a couple of opinionated workflow defaults.
   ────────────────────────────────────────────────────────────── */
const ORG_ARCHETYPES = {
  ifc: {
    key: "ifc",
    label: "IFC Fraternity",
    short: "IFC",
    description: "Traditional men's fraternity, NIC-affiliated. Rush, dues, risk, ritual.",
    council: "Interfraternity Council",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: true, hours: true,
      backwork: true, polls: true,
      onboarding: true, rush: true, billing: true, reports: true,
      academics: true, philanthropy: true, risk: true,
    },
    rolePack: "ifc_standard",
    recruitmentLanguage: "Rush",
    pledgeLanguage: "New member",
    classLanguage: "Pledge class",
    duesCadence: "semester",
    requirePresidentApprovalOnBudgetOver: 500,
  },
  npc: {
    key: "npc",
    label: "NPC Sorority",
    short: "NPC",
    description: "National Panhellenic Conference. Structured recruitment, standards, philanthropy-heavy.",
    council: "Panhellenic Council",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: true, hours: true,
      backwork: true, polls: true,
      onboarding: true, rush: true, billing: true, reports: true,
      academics: true, philanthropy: true, risk: true,
      standards: true, // NPC-specific
    },
    rolePack: "npc_standard",
    recruitmentLanguage: "Recruitment",
    pledgeLanguage: "New member",
    classLanguage: "New member class",
    duesCadence: "semester",
    requirePresidentApprovalOnBudgetOver: 250,
  },
  nphc: {
    key: "nphc",
    label: "NPHC / Divine Nine",
    short: "NPHC",
    description: "Historically Black Greek-letter organization. Smaller chapters, line-based, ritual-rich.",
    council: "National Pan-Hellenic Council",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: false, hours: true,
      backwork: true, polls: false,
      onboarding: true, rush: false, billing: true, reports: true,
      academics: false, philanthropy: true, risk: false,
      lines: true, // NPHC-specific
    },
    rolePack: "nphc_standard",
    recruitmentLanguage: "Intake",
    pledgeLanguage: "Aspirant",
    classLanguage: "Line",
    duesCadence: "annual",
    requirePresidentApprovalOnBudgetOver: 100,
  },
  mgc: {
    key: "mgc",
    label: "Multicultural Greek",
    short: "MGC",
    description: "Multicultural Greek Council orgs — values-based, community-rooted.",
    council: "Multicultural Greek Council",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: true, hours: true,
      backwork: true, polls: true,
      onboarding: true, rush: false, billing: true, reports: true,
      academics: true, philanthropy: true, risk: true,
      lines: true,
    },
    rolePack: "ifc_standard",
    recruitmentLanguage: "Intake",
    pledgeLanguage: "New member",
    classLanguage: "Line",
    duesCadence: "semester",
    requirePresidentApprovalOnBudgetOver: 300,
  },
  professional: {
    key: "professional",
    label: "Professional Fraternity",
    short: "Pro",
    description: "Business, law, engineering. Co-ed often. Networking-first.",
    council: "Professional Fraternity Association",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: true, hours: false,
      backwork: true, polls: true,
      onboarding: true, rush: true, billing: true, reports: true,
      academics: true, philanthropy: false, risk: false,
      networking: true,
    },
    rolePack: "professional",
    recruitmentLanguage: "Recruitment",
    pledgeLanguage: "Candidate",
    classLanguage: "Cohort",
    duesCadence: "semester",
    requirePresidentApprovalOnBudgetOver: 250,
  },
  service: {
    key: "service",
    label: "Co-ed Service Fraternity",
    short: "Svc",
    description: "APO-style. Service hours are the spine of the org.",
    council: "Service Fraternity",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: false, hours: true,
      backwork: true, polls: true,
      onboarding: true, rush: true, billing: true, reports: true,
      academics: false, philanthropy: true, risk: false,
      serviceFirst: true,
    },
    rolePack: "service",
    recruitmentLanguage: "Rush",
    pledgeLanguage: "Pledge",
    classLanguage: "Pledge class",
    duesCadence: "semester",
    requirePresidentApprovalOnBudgetOver: 150,
  },
  honor: {
    key: "honor",
    label: "Honor Society",
    short: "Honor",
    description: "Academic merit. Light operations, induction-driven.",
    council: "Association of College Honor Societies",
    modules: {
      chat: true, events: true, tasks: false,
      members: true, points: false, hours: false,
      backwork: true, polls: false,
      onboarding: false, rush: false, billing: true, reports: false,
      academics: true,
    },
    rolePack: "honor",
    recruitmentLanguage: "Induction",
    pledgeLanguage: "Inductee",
    classLanguage: "Class",
    duesCadence: "annual",
    requirePresidentApprovalOnBudgetOver: 100,
  },
  colony: {
    key: "colony",
    label: "Colony / Interest Group",
    short: "Colony",
    description: "Pre-chartered. Minimum viable ops while you build toward charter.",
    council: "—",
    modules: {
      chat: true, events: true, tasks: true,
      members: true, points: false, hours: false,
      backwork: false, polls: false,
      onboarding: false, rush: true, billing: false, reports: false,
    },
    rolePack: "minimal",
    recruitmentLanguage: "Rush",
    pledgeLanguage: "Founding member",
    classLanguage: "Founding class",
    duesCadence: "semester",
    requirePresidentApprovalOnBudgetOver: 0,
  },
};

/* ──────────────────────────────────────────────────────────────
   Module catalog — the toggleable surfaces in the app. Each module
   carries sub-features that can be toggled independently for finer
   control. This is what the Settings → Features screen renders.
   ────────────────────────────────────────────────────────────── */
const MODULE_CATALOG = [
  { key: "chat",      label: "Chat",            icon: "message",  category: "core",
    description: "Channels and DMs scoped to the chapter and committees.",
    subFeatures: [
      { key: "chat.channels",    label: "Channels",                  defaultOn: true },
      { key: "chat.dms",         label: "Direct messages",           defaultOn: true },
      { key: "chat.pins",        label: "Pinned messages",           defaultOn: true },
      { key: "chat.threads",     label: "Threaded replies",          defaultOn: true },
      { key: "chat.reactions",   label: "Reactions",                 defaultOn: true },
      { key: "chat.broadcast",   label: "President broadcast channel", defaultOn: true },
    ],
  },
  { key: "events",    label: "Events",          icon: "calendar", category: "core",
    description: "Calendar, RSVP, attendance scans, post-event points.",
    subFeatures: [
      { key: "events.rsvp",         label: "RSVP",                       defaultOn: true },
      { key: "events.qrCheckIn",    label: "QR check-in",                defaultOn: true },
      { key: "events.geoCheckIn",   label: "Geo-fenced check-in",        defaultOn: false },
      { key: "events.proxyVote",    label: "Proxy voting on chapter votes", defaultOn: true },
      { key: "events.postSurvey",   label: "Post-event survey",          defaultOn: false },
      { key: "events.autoPoints",   label: "Auto-grant points on attend", defaultOn: true },
    ],
  },
  { key: "tasks",     label: "Tasks",           icon: "check",    category: "core",
    description: "Assignments, confirmations, points-on-completion.",
    subFeatures: [
      { key: "tasks.assign",     label: "Assign tasks",                defaultOn: true },
      { key: "tasks.confirm",    label: "Require confirmation by assigner", defaultOn: true },
      { key: "tasks.photoProof", label: "Photo proof on completion",   defaultOn: false },
      { key: "tasks.recurring",  label: "Recurring tasks",             defaultOn: true },
    ],
  },
  { key: "members",   label: "Members",         icon: "users",    category: "core",
    description: "Roster, profiles, contact info, custom fields.",
    subFeatures: [
      { key: "members.directory",   label: "Searchable directory",       defaultOn: true },
      { key: "members.customFields",label: "Custom member fields",       defaultOn: true },
      { key: "members.emergency",   label: "Emergency contacts",         defaultOn: true },
      { key: "members.alumni",      label: "Alumni status",              defaultOn: true },
    ],
  },
  { key: "points",    label: "Points",          icon: "star",     category: "chapter",
    description: "Earn/spend tracking for participation. Append-only ledger.",
    subFeatures: [
      { key: "points.adjust",       label: "Manual adjustments",         defaultOn: true },
      { key: "points.leaderboard",  label: "Public leaderboard",         defaultOn: true },
      { key: "points.categories",   label: "Custom point categories",    defaultOn: true },
      { key: "points.minimum",      label: "Enforce point minimum per term", defaultOn: false },
    ],
  },
  { key: "hours",     label: "Service hours",   icon: "clock",    category: "chapter",
    description: "Service/philanthropy time tracking with approval queue.",
    subFeatures: [
      { key: "hours.selfReport",    label: "Self-reported submissions",  defaultOn: true },
      { key: "hours.approval",      label: "Approval queue",             defaultOn: true },
      { key: "hours.receipt",       label: "Require photo / signed slip", defaultOn: true },
      { key: "hours.minimum",       label: "Enforce hour minimum per term", defaultOn: true },
    ],
  },
  { key: "backwork",  label: "Backwork",        icon: "folder",   category: "chapter",
    description: "Chapter document library + academic archive.",
    subFeatures: [
      { key: "backwork.chapter",    label: "Chapter docs",               defaultOn: true },
      { key: "backwork.academic",   label: "Academic archive (past exams etc.)", defaultOn: true },
      { key: "backwork.redaction",  label: "Redaction enforced on upload", defaultOn: true },
      { key: "backwork.ratings",    label: "Resource ratings",           defaultOn: true },
    ],
  },
  { key: "polls",     label: "Polls",           icon: "poll",     category: "chapter",
    description: "Lightweight chapter votes, anonymous or named.",
    subFeatures: [
      { key: "polls.anonymous",     label: "Anonymous mode",             defaultOn: true },
      { key: "polls.quorum",        label: "Quorum enforcement",         defaultOn: true },
    ],
  },
  { key: "onboarding",label: "Onboarding",      icon: "sparkles", category: "admin",
    description: "Structured pathway for new members through initiation.",
    subFeatures: [
      { key: "onboarding.pathway",  label: "Weekly pathway",             defaultOn: true },
      { key: "onboarding.bigLittle",label: "Big/Little pairing",         defaultOn: true },
      { key: "onboarding.quiz",     label: "History/values quiz",        defaultOn: true },
    ],
  },
  { key: "rush",      label: "Recruitment",     icon: "funnel",   category: "admin",
    description: "Candidate funnel, voting, bid management.",
    subFeatures: [
      { key: "rush.funnel",         label: "Stage funnel",               defaultOn: true },
      { key: "rush.scoring",        label: "Candidate scoring",          defaultOn: true },
      { key: "rush.voting",         label: "Anonymous vote at bid",      defaultOn: true },
      { key: "rush.referrals",      label: "Member referrals tracked",   defaultOn: true },
    ],
  },
  { key: "billing",   label: "Billing",         icon: "card",     category: "admin",
    description: "Dues, invoices, payment plans, scholarships.",
    subFeatures: [
      { key: "billing.plans",       label: "Payment plans",              defaultOn: true },
      { key: "billing.late",        label: "Late fees",                  defaultOn: false },
      { key: "billing.scholarship", label: "Scholarship adjustments",    defaultOn: true },
      { key: "billing.ach",         label: "ACH (no card fees)",         defaultOn: true },
      { key: "billing.card",        label: "Card payments",              defaultOn: true },
      { key: "billing.parent",      label: "Parent-pay portal",          defaultOn: false },
    ],
  },
  { key: "reports",   label: "Reports",         icon: "chart",    category: "admin",
    description: "Chapter health: attendance, dues, hours, retention.",
    subFeatures: [
      { key: "reports.exec",        label: "Exec dashboard",             defaultOn: true },
      { key: "reports.nationals",   label: "Nationals export",           defaultOn: true },
      { key: "reports.advisor",     label: "Advisor digest (email)",     defaultOn: false },
    ],
  },
];

/* ──────────────────────────────────────────────────────────────
   Role packs — vocabulary varies by archetype. UI shows the org's
   own words, not "President / VP" if they don't call them that.
   ────────────────────────────────────────────────────────────── */
const ROLE_PACKS = {
  ifc_standard: [
    { key: "president",  label: "President",        rank: 1 },
    { key: "vp",         label: "Vice President",   rank: 2 },
    { key: "treasurer",  label: "Treasurer",        rank: 3 },
    { key: "secretary",  label: "Secretary",        rank: 4 },
    { key: "risk",       label: "Risk Manager",     rank: 5, optional: true },
    { key: "rush_chair", label: "Rush Chair",       rank: 6, optional: true },
    { key: "philan",     label: "Philanthropy Chair", rank: 7, optional: true },
    { key: "social",     label: "Social Chair",     rank: 8, optional: true },
    { key: "newmem_ed",  label: "New Member Educator", rank: 9, optional: true },
    { key: "member",     label: "Active Member",    rank: 10 },
    { key: "newmember",  label: "New Member",       rank: 11 },
  ],
  npc_standard: [
    { key: "president",   label: "President",          rank: 1 },
    { key: "vp",          label: "Vice President",     rank: 2 },
    { key: "treasurer",   label: "Treasurer",          rank: 3 },
    { key: "secretary",   label: "Recording Secretary", rank: 4 },
    { key: "standards",   label: "Standards Chair",    rank: 5 },
    { key: "rush_chair",  label: "Recruitment Chair",  rank: 6 },
    { key: "philan",      label: "Philanthropy Chair", rank: 7 },
    { key: "panhel",      label: "Panhellenic Delegate", rank: 8 },
    { key: "newmem_ed",   label: "New Member Educator", rank: 9 },
    { key: "member",      label: "Active Member",      rank: 10 },
    { key: "newmember",   label: "New Member",         rank: 11 },
  ],
  nphc_standard: [
    { key: "president",    label: "Basileus / President", rank: 1 },
    { key: "vp",           label: "Anti-Basileus / VP",   rank: 2 },
    { key: "treasurer",    label: "Tamiouchos / Treasurer", rank: 3 },
    { key: "secretary",    label: "Grammateus / Secretary", rank: 4 },
    { key: "member",       label: "Member",                rank: 5 },
    { key: "aspirant",     label: "Aspirant",              rank: 6 },
  ],
  professional: [
    { key: "president",  label: "President",         rank: 1 },
    { key: "vp_pro",     label: "VP of Professional Dev", rank: 2 },
    { key: "vp_mem",     label: "VP of Membership",  rank: 3 },
    { key: "treasurer",  label: "Treasurer",         rank: 4 },
    { key: "secretary",  label: "Secretary",         rank: 5 },
    { key: "member",     label: "Brother / Sister",  rank: 6 },
    { key: "candidate",  label: "Candidate",         rank: 7 },
  ],
  service: [
    { key: "president",  label: "President",         rank: 1 },
    { key: "vp_service", label: "VP of Service",     rank: 2 },
    { key: "vp_member",  label: "VP of Membership",  rank: 3 },
    { key: "treasurer",  label: "Treasurer",         rank: 4 },
    { key: "secretary",  label: "Secretary",         rank: 5 },
    { key: "member",     label: "Active Brother",    rank: 6 },
    { key: "pledge",     label: "Pledge",            rank: 7 },
  ],
  honor: [
    { key: "president", label: "President",     rank: 1 },
    { key: "vp",        label: "Vice President", rank: 2 },
    { key: "treasurer", label: "Treasurer",     rank: 3 },
    { key: "secretary", label: "Secretary",     rank: 4 },
    { key: "advisor",   label: "Faculty Advisor", rank: 5 },
    { key: "member",    label: "Inductee",      rank: 6 },
  ],
  minimal: [
    { key: "president", label: "Founding President", rank: 1 },
    { key: "vp",        label: "Founding VP",        rank: 2 },
    { key: "treasurer", label: "Treasurer",          rank: 3 },
    { key: "member",    label: "Founding Member",    rank: 4 },
  ],
};

/* ──────────────────────────────────────────────────────────────
   Custom fields seed — what's on a member profile beyond defaults.
   ────────────────────────────────────────────────────────────── */
const CUSTOM_FIELDS_SEED = [
  { id: "cf_1", label: "Major",            type: "text",   required: true,  visibleTo: "chapter" },
  { id: "cf_2", label: "Graduation year",  type: "number", required: true,  visibleTo: "chapter" },
  { id: "cf_3", label: "Allergies",        type: "text",   required: false, visibleTo: "exec",   sensitive: true },
  { id: "cf_4", label: "T-shirt size",     type: "select", required: false, visibleTo: "chapter", options: ["XS","S","M","L","XL","XXL"] },
  { id: "cf_5", label: "Dietary",          type: "select", required: false, visibleTo: "exec",   options: ["None","Vegetarian","Vegan","Kosher","Halal","GF"] },
  { id: "cf_6", label: "Emergency contact (name)", type: "text", required: true, visibleTo: "exec", sensitive: true },
  { id: "cf_7", label: "Emergency contact (phone)", type: "phone", required: true, visibleTo: "exec", sensitive: true },
  { id: "cf_8", label: "Cumulative GPA",   type: "decimal", required: false, visibleTo: "president", sensitive: true },
];

/* ──────────────────────────────────────────────────────────────
   Workflows — opinionated org behaviors. Yes/no per workflow.
   ────────────────────────────────────────────────────────────── */
const WORKFLOWS_SEED = [
  { key: "wf_budget_approval", label: "President approval on budget items over threshold",
    enabled: true, threshold: 500, units: "USD" },
  { key: "wf_task_confirm",    label: "Task creator must confirm completion",
    enabled: true },
  { key: "wf_event_photo",     label: "Require photo proof for event attendance",
    enabled: false },
  { key: "wf_dues_grace",      label: "Dues grace period before late status",
    enabled: true, threshold: 7, units: "days" },
  { key: "wf_hours_receipt",   label: "Service hours require receipt (photo or signature)",
    enabled: true },
  { key: "wf_rush_anon_vote",  label: "Rush vote is anonymous (one click per active)",
    enabled: true },
  { key: "wf_standards_private", label: "Standards reports are private to standards chair + president",
    enabled: true },
  { key: "wf_advisor_digest",  label: "Send chapter advisor a weekly digest email",
    enabled: false },
  { key: "wf_nationals_export", label: "Auto-export monthly report to nationals",
    enabled: false },
];

/* ──────────────────────────────────────────────────────────────
   Dues schemes — orgs configure their own structure.
   ────────────────────────────────────────────────────────────── */
const DUES_SCHEME_SEED = {
  cadence: "semester",         // semester | monthly | annual
  baseAmount: 850,             // active member
  newMemberAmount: 425,        // new member
  alumniAmount: 0,
  installmentsAllowed: true,
  installmentMax: 4,
  lateFeeEnabled: false,
  lateFeeAmount: 25,
  gracePeriodDays: 7,
  scholarshipPool: 1200,
};

/* ──────────────────────────────────────────────────────────────
   Default ORG_CONFIG. The Tweaks panel can swap archetypes and
   flip module/sub-feature toggles, which the rest of the app reads.
   ────────────────────────────────────────────────────────────── */
const ARCHETYPE_DEFAULT = "ifc";

function makeOrgConfig(archetypeKey) {
  const a = ORG_ARCHETYPES[archetypeKey] || ORG_ARCHETYPES.ifc;
  // Build sub-features defaulted to ON for enabled modules.
  const subs = {};
  MODULE_CATALOG.forEach(m => {
    m.subFeatures.forEach(sf => { subs[sf.key] = sf.defaultOn && a.modules[m.key] !== false; });
  });
  return {
    archetype: a.key,
    modules: { ...a.modules },
    subFeatures: subs,
    rolePack: a.rolePack,
    vocabulary: {
      recruitment: a.recruitmentLanguage,
      pledge:      a.pledgeLanguage,
      class:       a.classLanguage,
    },
    customFields: [...CUSTOM_FIELDS_SEED],
    workflows: WORKFLOWS_SEED.map(w => ({ ...w })),
    dues: { ...DUES_SCHEME_SEED, cadence: a.duesCadence },
    branding: {
      letters: "ΦΓΔ",
      chapterName: "Phi Gamma Delta",
      chapterDesignation: "Pi Tau",
      school: "Rensselaer Polytechnic Institute",
      schoolShort: "RPI",
      foundedAt: 1878,
      colors: ["#4B2E2E", "#C9A56F"],
    },
    beta: {
      enabled: true,
      style: "sidebar_pill", // sidebar_pill | top_banner | corner_badge | breadcrumb_pill
    },
  };
}

const ORG_CONFIG_DEFAULT = makeOrgConfig(ARCHETYPE_DEFAULT);

/* Helper: is a top-level module currently enabled? */
function isModuleEnabled(config, moduleKey) {
  return config?.modules?.[moduleKey] !== false;
}

/* Helper: is a sub-feature enabled? */
function isFeatureEnabled(config, featureKey) {
  return config?.subFeatures?.[featureKey] !== false;
}

Object.assign(window, {
  ORG_ARCHETYPES, MODULE_CATALOG, ROLE_PACKS,
  CUSTOM_FIELDS_SEED, WORKFLOWS_SEED, DUES_SCHEME_SEED,
  makeOrgConfig, ORG_CONFIG_DEFAULT,
  isModuleEnabled, isFeatureEnabled,
});
