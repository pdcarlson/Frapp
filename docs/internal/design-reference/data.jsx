/* Frapp — data layer.
   Types & fixtures aligned to the real Drizzle schema (apps/api/src/db/schema.ts)
   and API routes (apps/api/src/routes/*). No mocks beyond what the backend can serve.
*/

/* ──────────────────────────────────────────────────────────────
   Roles & permissions
   Source: packages/shared/src/permissions.ts (BasicRBAC)
   ────────────────────────────────────────────────────────────── */
const ROLES = {
  president:   { key: "president",   label: "President",    hue: "var(--hue-rose)"   },
  vp:          { key: "vp",          label: "Vice President", hue: "var(--hue-violet)" },
  treasurer:   { key: "treasurer",   label: "Treasurer",    hue: "var(--hue-amber)"  },
  secretary:   { key: "secretary",   label: "Secretary",    hue: "var(--hue-teal)"   },
  exec:        { key: "exec",        label: "Exec",         hue: "var(--hue-violet)" },
  chair:       { key: "chair",       label: "Committee Chair", hue: "var(--hue-lime)" },
  member:      { key: "member",      label: "Member",       hue: "var(--primary)"    },
  newmember:   { key: "newmember",   label: "New Member",   hue: "var(--fg-subtle)"  },
};

/* Capability matrix. Mirrors BasicRBAC.can() checks we saw in the repo.
   Used to gate UI surfaces before the API round-trip. */
const CAPS = {
  president: new Set([
    "chapter.manage", "members.invite", "members.role.assign", "events.create",
    "events.manage", "points.adjust", "tasks.assign", "tasks.confirm",
    "backwork.upload", "backwork.manage", "billing.view", "billing.manage",
    "rush.manage", "onboarding.manage", "reports.view",
  ]),
  vp: new Set([
    "members.invite", "events.create", "events.manage", "tasks.assign",
    "tasks.confirm", "backwork.upload", "backwork.manage", "onboarding.manage",
    "reports.view",
  ]),
  treasurer: new Set([
    "billing.view", "billing.manage", "points.adjust", "reports.view",
  ]),
  secretary: new Set([
    "events.create", "events.manage", "members.invite", "reports.view",
  ]),
  exec: new Set([
    "events.create", "tasks.assign", "points.adjust", "reports.view",
  ]),
  chair: new Set([
    "events.create", "tasks.assign", "points.adjust",
  ]),
  member: new Set([]),
  newmember: new Set([]),
};

const hasCap = (role, cap) => (CAPS[role] || new Set()).has(cap);

/* ──────────────────────────────────────────────────────────────
   Current user — toggled by the role switcher
   ────────────────────────────────────────────────────────────── */
const CURRENT_USERS = {
  president: { id: "u_01", name: "Marcus Chen",  role: "president", pledgeClass: "Alpha 2022", avatar: "var(--hue-rose)" },
  treasurer: { id: "u_02", name: "Priya Shah",   role: "treasurer", pledgeClass: "Alpha 2022", avatar: "var(--hue-amber)" },
  vp:        { id: "u_03", name: "Jordan Webb",  role: "vp",        pledgeClass: "Alpha 2022", avatar: "var(--hue-violet)" },
  member:    { id: "u_05", name: "Elena Park",   role: "member",    pledgeClass: "Beta 2023",  avatar: "var(--primary)" },
  newmember: { id: "u_09", name: "Aiden Kowalski", role: "newmember", pledgeClass: "Gamma 2024", avatar: "var(--hue-teal)" },
};

const CHAPTER = {
  id: "ch_rpi_phigam",
  name: "Phi Gamma Delta — RPI",
  greek: "ΦΓΔ",
  university: "Rensselaer Polytechnic",
  memberCount: 84,
  founded: "1878",
};

/* ──────────────────────────────────────────────────────────────
   Nav config — mirrors apps/web/src/config/nav-config.ts
   "status" values: "stable" | "beta" | "soon" — we don't invent routes
   ────────────────────────────────────────────────────────────── */
const NAV_CONFIG = [
  {
    label: "Today",
    items: [
      { key: "home",     label: "Home",       icon: "home",    status: "stable" },
      { key: "chat",     label: "Chat",       icon: "message", status: "stable", badge: 4 },
      { key: "events",   label: "Events",     icon: "calendar", status: "stable" },
      { key: "tasks",    label: "Tasks",      icon: "check",   status: "stable", badge: 2 },
    ],
  },
  {
    label: "Chapter",
    items: [
      { key: "members",  label: "Members",    icon: "users",   status: "stable" },
      { key: "points",   label: "Points",     icon: "star",    status: "stable" },
      { key: "hours",    label: "Service hours", icon: "clock", status: "beta" },
      { key: "backwork", label: "Backwork",   icon: "folder",  status: "stable", capabilityHint: "backwork.upload" },
      { key: "polls",    label: "Polls",      icon: "poll",    status: "beta" },
    ],
  },
  {
    label: "Admin",
    items: [
      { key: "onboarding", label: "Onboarding",  icon: "sparkles", status: "stable", capability: "onboarding.manage" },
      { key: "rush",       label: "Rush",        icon: "funnel",   status: "beta",   capability: "rush.manage" },
      { key: "billing",    label: "Billing",     icon: "card",     status: "beta",   capability: "billing.view" },
      { key: "reports",    label: "Reports",     icon: "chart",    status: "soon",   capability: "reports.view" },
      { key: "settings",   label: "Settings",    icon: "gear",     status: "stable", capability: "chapter.manage" },
    ],
  },
];

/* ──────────────────────────────────────────────────────────────
   Members — shape matches `members` + `users` tables
   ────────────────────────────────────────────────────────────── */
const MEMBERS_SEED = [
  ["u_01", "Marcus Chen",        "marcus.chen@stanford.edu",   "president",  "Alpha 2022", true,  "online", "CS",           "Senior",    "650-555-0101"],
  ["u_02", "Priya Shah",         "priya.shah@stanford.edu",    "treasurer",  "Alpha 2022", true,  "online", "Economics",    "Senior",    "650-555-0102"],
  ["u_03", "Jordan Webb",        "jordan.webb@stanford.edu",   "vp",         "Alpha 2022", true,  "idle",   "Political Sci","Senior",    "650-555-0103"],
  ["u_04", "Sam Rivera",         "sam.rivera@stanford.edu",    "secretary",  "Alpha 2022", true,  "offline","Psychology",   "Senior",    "650-555-0104"],
  ["u_05", "Elena Park",         "elena.park@stanford.edu",    "member",     "Beta 2023",  true,  "online", "MechE",        "Junior",    "650-555-0105"],
  ["u_06", "Diego Alvarez",      "diego.alvarez@stanford.edu", "chair",      "Beta 2023",  true,  "online", "History",      "Junior",    "650-555-0106"],
  ["u_07", "Kai Thompson",       "kai.thompson@stanford.edu",  "exec",       "Beta 2023",  true,  "idle",   "Bio",          "Junior",    "650-555-0107"],
  ["u_08", "Nora Bianchi",       "nora.bianchi@stanford.edu",  "member",     "Beta 2023",  true,  "offline","English",      "Junior",    "650-555-0108"],
  ["u_09", "Aiden Kowalski",     "aiden.k@stanford.edu",       "newmember",  "Gamma 2024", true,  "online", "CS",           "Sophomore", "650-555-0109"],
  ["u_10", "Rio Nakamura",       "rio.nakamura@stanford.edu",  "newmember",  "Gamma 2024", true,  "online", "Econ",         "Sophomore", "650-555-0110"],
  ["u_11", "Hana Abdi",          "hana.abdi@stanford.edu",     "newmember",  "Gamma 2024", true,  "idle",   "Art History",  "Sophomore", "650-555-0111"],
  ["u_12", "Theo Brennan",       "theo.brennan@stanford.edu",  "newmember",  "Gamma 2024", true,  "offline","Chem",         "Sophomore", "650-555-0112"],
  ["u_13", "Cass Okafor",        "cass.okafor@stanford.edu",   "newmember",  "Gamma 2024", true,  "online", "Public Policy","Sophomore", "650-555-0113"],
  ["u_14", "Leah Goldberg",      "leah.goldberg@stanford.edu", "member",     "Beta 2023",  true,  "online", "Symbolic Sys", "Junior",    "650-555-0114"],
  ["u_15", "Wes Holloway",       "wes.holloway@stanford.edu",  "member",     "Alpha 2022", false, "offline","Urban Studies","Alumnus",   "—"],
  ["u_16", "Tara Singh",         "tara.singh@stanford.edu",    "member",     "Beta 2023",  true,  "idle",   "Biochem",      "Junior",    "650-555-0116"],
].map(([id, name, email, role, pledgeClass, active, presence, major, year, phone]) => ({
  id, name, email, role, pledgeClass, active, presence, major, year, phone,
  initials: name.split(" ").map(p => p[0]).slice(0, 2).join(""),
  hue: role === "newmember" ? "var(--hue-teal)" :
       role === "president" ? "var(--hue-rose)" :
       role === "treasurer" ? "var(--hue-amber)" :
       role === "vp"        ? "var(--hue-violet)" :
       role === "chair"     ? "var(--hue-lime)" :
       "var(--primary)",
  // Synthetic fields for now, flagged as proposed in UI where they surface:
  pointBalance: Math.floor(50 + ((id.charCodeAt(2) * 7) % 180)),
  hoursThisTerm: Math.floor(((id.charCodeAt(3) * 3) % 24)),
  joinedAt: role === "newmember" ? "2024-09-14" : role === "member" ? "2023-09-10" : "2022-09-11",
}));

/* ──────────────────────────────────────────────────────────────
   Events — from events/attendance routes (/events, /events/:id/attendance)
   ────────────────────────────────────────────────────────────── */
const EVENTS_SEED = [
  {
    id: "e_01", title: "Chapter Meeting", category: "Mandatory",
    startsAt: "2026-04-28T19:00:00", endsAt: "2026-04-28T20:30:00",
    location: "House Library", locationCoords: [37.4275, -122.1697],
    hostIds: ["u_01","u_03"], description: "Weekly business + officer reports + vote on homecoming budget.",
    requiresCheckIn: true, attendance: { confirmed: 68, declined: 4, maybe: 6, checkedIn: 0 },
    points: 5, visibility: "all", createdBy: "u_01",
  },
  {
    id: "e_02", title: "Community Service: Beach Cleanup", category: "Service",
    startsAt: "2026-05-02T09:00:00", endsAt: "2026-05-02T12:00:00",
    location: "Half Moon Bay — Pillar Point", locationCoords: [37.4967, -122.4978],
    hostIds: ["u_06"], description: "3 hrs counts toward service requirement. Meet at lot by 8:45a.",
    requiresCheckIn: true, attendance: { confirmed: 22, declined: 8, maybe: 14, checkedIn: 0 },
    points: 10, serviceHours: 3, visibility: "all", createdBy: "u_06",
  },
  {
    id: "e_03", title: "Alumni Mixer", category: "Social",
    startsAt: "2026-05-05T18:30:00", endsAt: "2026-05-05T21:00:00",
    location: "The Old Pro, Palo Alto", locationCoords: [37.4438, -122.1615],
    hostIds: ["u_03","u_05"], description: "Reconnect with alumni. Dress: smart casual.",
    requiresCheckIn: false, attendance: { confirmed: 41, declined: 12, maybe: 9, checkedIn: 0 },
    points: 3, visibility: "all", createdBy: "u_03",
  },
  {
    id: "e_04", title: "New Member Ed — Session 4", category: "New Member",
    startsAt: "2026-04-25T20:00:00", endsAt: "2026-04-25T21:30:00",
    location: "House Main", hostIds: ["u_07"],
    description: "Ritual history + values discussion. Binders required.",
    requiresCheckIn: true, attendance: { confirmed: 5, declined: 0, maybe: 0, checkedIn: 5 },
    points: 5, visibility: "newmember", createdBy: "u_07", isPast: false,
  },
  {
    id: "e_05", title: "Philanthropy Planning", category: "Committee",
    startsAt: "2026-04-24T17:00:00", endsAt: "2026-04-24T18:00:00",
    location: "Zoom", hostIds: ["u_06"], description: "Spring 5K prep. Committee only.",
    requiresCheckIn: false, attendance: { confirmed: 9, declined: 2, maybe: 1, checkedIn: 0 },
    points: 2, visibility: "committee", createdBy: "u_06",
  },
  {
    id: "e_06", title: "House Cleanup", category: "House",
    startsAt: "2026-04-20T10:00:00", endsAt: "2026-04-20T12:00:00",
    location: "Chapter House", hostIds: ["u_05"],
    description: "Spring deep clean. All members.",
    requiresCheckIn: true, attendance: { confirmed: 60, declined: 10, maybe: 8, checkedIn: 54 },
    points: 5, visibility: "all", createdBy: "u_05", isPast: true,
  },
];

/* ──────────────────────────────────────────────────────────────
   Chat — channels + messages. Shape from chat routes + schema.
   ────────────────────────────────────────────────────────────── */
const CHANNELS_SEED = [
  { id: "c_gen",    name: "general",         type: "channel", unread: 0, muted: false, description: "Open channel — everyone's in." },
  { id: "c_ann",    name: "announcements",   type: "channel", unread: 2, muted: false, description: "Admin-post-only. Everyone reads.", postingRoles: ["president","vp","exec"] },
  { id: "c_soc",    name: "social",          type: "channel", unread: 0, muted: false },
  { id: "c_srv",    name: "service",         type: "channel", unread: 0, muted: true },
  { id: "c_exec",   name: "exec",            type: "channel", unread: 1, muted: false, description: "Exec board only.", visibility: ["president","vp","treasurer","secretary","exec"] },
  { id: "c_newmem", name: "new-member-ed",   type: "channel", unread: 0, muted: false, visibility: ["president","vp","exec","newmember"] },
  { id: "c_philan", name: "philanthropy-cmte", type: "channel", unread: 3, muted: false },
  { id: "dm_02",    name: "Priya Shah",      type: "dm",      unread: 1, muted: false, userId: "u_02" },
  { id: "dm_03",    name: "Jordan Webb",     type: "dm",      unread: 0, muted: false, userId: "u_03" },
];

const MESSAGES_SEED = {
  c_gen: [
    { id: "m_1", authorId: "u_04", at: "2026-04-23T14:02:00", body: "Heads up — I left my binder in the library last night. If anyone finds it lmk.", reactions: [{ emoji: "👀", by: ["u_05","u_01"] }] },
    { id: "m_2", authorId: "u_05", at: "2026-04-23T14:05:00", body: "Saw it on the armchair this morning, I brought it to Priya's room.", reactions: [{ emoji: "🙏", by: ["u_04"] }] },
    { id: "m_3", authorId: "u_04", at: "2026-04-23T14:05:30", body: "legend", reactions: [] },
    { id: "m_4", authorId: "u_01", at: "2026-04-23T16:30:00", body: "Reminder: chapter meeting Tuesday 7pm. Homecoming budget vote — please read the doc I pinned in #exec before voting. If you can't make it, proxy vote via Events detail page.", pinned: true, reactions: [{ emoji: "✅", by: ["u_02","u_05","u_06","u_07","u_14"] }] },
    { id: "m_5", authorId: "u_06", at: "2026-04-23T17:10:00", body: "5K planning — we need 2 more volunteers for registration table. DM me.", reactions: [] },
    { id: "m_6", authorId: "u_09", at: "2026-04-23T17:22:00", body: "Can new members help with the 5K registration? Happy to!", replyTo: "m_5", reactions: [] },
    { id: "m_7", authorId: "u_06", at: "2026-04-23T17:24:00", body: "Yes please — you'd count it as service hours.", replyTo: "m_5", reactions: [{ emoji: "🎉", by: ["u_09","u_10"] }] },
  ],
  c_ann: [
    { id: "m_a1", authorId: "u_01", at: "2026-04-22T10:00:00", body: "Q2 dues invoices are out. Due May 15. See Billing tab. Payment plan available — DM Priya.", pinned: true, reactions: [] },
    { id: "m_a2", authorId: "u_03", at: "2026-04-23T09:30:00", body: "Nationals sent over the updated risk management policy. Required reading — link in Backwork.", reactions: [] },
  ],
  c_exec: [
    { id: "m_e1", authorId: "u_01", at: "2026-04-23T19:00:00", body: "Agenda doc for Tuesday is in Backwork → Exec → Meetings. Please review before the meeting.", pinned: true, reactions: [] },
    { id: "m_e2", authorId: "u_02", at: "2026-04-23T19:15:00", body: "Treasury brief: 3 members past due. I'll present options for payment plans.", reactions: [] },
  ],
};

/* ──────────────────────────────────────────────────────────────
   Tasks — from tasks route
   ────────────────────────────────────────────────────────────── */
const TASKS_SEED = [
  { id: "t_1", title: "Finalize homecoming budget deck", assigneeIds: ["u_01"], dueAt: "2026-04-28", status: "in_progress", points: 15, createdBy: "u_01", category: "Chapter" },
  { id: "t_2", title: "Post week's meal plan to #general", assigneeIds: ["u_05"], dueAt: "2026-04-24", status: "todo", points: 3, createdBy: "u_01", category: "House" },
  { id: "t_3", title: "Collect Q2 dues payment confirmations", assigneeIds: ["u_02"], dueAt: "2026-05-15", status: "in_progress", points: 20, createdBy: "u_01", category: "Finance" },
  { id: "t_4", title: "Print new-member ed packets (15)", assigneeIds: ["u_07"], dueAt: "2026-04-24", status: "done", points: 5, createdBy: "u_03", category: "Onboarding" },
  { id: "t_5", title: "Book venue for alumni mixer", assigneeIds: ["u_03"], dueAt: "2026-04-30", status: "todo", points: 10, createdBy: "u_01", category: "Events" },
  { id: "t_6", title: "Reach out to philanthropy beneficiaries", assigneeIds: ["u_06"], dueAt: "2026-05-02", status: "todo", points: 8, createdBy: "u_01", category: "Philanthropy" },
  { id: "t_7", title: "Send candidate list to nationals", assigneeIds: ["u_04"], dueAt: "2026-04-26", status: "awaiting_confirm", points: 5, createdBy: "u_04", category: "Onboarding" },
  { id: "t_8", title: "Audit points ledger for Spring", assigneeIds: ["u_07","u_02"], dueAt: "2026-05-10", status: "todo", points: 15, createdBy: "u_01", category: "Chapter" },
];

/* ──────────────────────────────────────────────────────────────
   Points ledger — from points route; append-only per behavior
   ────────────────────────────────────────────────────────────── */
const POINTS_LEDGER = [
  { id: "p_1", userId: "u_09", delta: +5,  reason: "Attended: New Member Ed 3", grantedBy: "u_07", at: "2026-04-20T21:30:00", refType: "event", refId: "e_04" },
  { id: "p_2", userId: "u_09", delta: +10, reason: "Service: Beach cleanup",    grantedBy: "u_06", at: "2026-04-18T12:05:00", refType: "event", refId: "e_02" },
  { id: "p_3", userId: "u_10", delta: +5,  reason: "Attended: New Member Ed 3", grantedBy: "u_07", at: "2026-04-20T21:30:00", refType: "event", refId: "e_04" },
  { id: "p_4", userId: "u_05", delta: +3,  reason: "Led chapter cleanup",       grantedBy: "u_01", at: "2026-04-20T12:30:00", refType: "task",  refId: "t_2" },
  { id: "p_5", userId: "u_11", delta: -2,  reason: "Missed chapter meeting (excused late)", grantedBy: "u_01", at: "2026-04-15T20:00:00" },
  { id: "p_6", userId: "u_09", delta: +3,  reason: "Task: Posted meal plan",    grantedBy: "u_01", at: "2026-04-17T11:00:00", refType: "task",  refId: "t_2" },
];

/* ──────────────────────────────────────────────────────────────
   Backwork — docs/files by category
   ────────────────────────────────────────────────────────────── */
const BACKWORK_SEED = [
  { id: "b_1", title: "Spring 2024 Chapter Minutes",   category: "Meetings", term: "Spring 2024", type: "pdf", pages: 84, uploadedBy: "u_04", uploadedAt: "2024-06-01", size: "2.1 MB", hasRedactions: true },
  { id: "b_2", title: "Fall 2023 Budget Report",       category: "Finance",  term: "Fall 2023",   type: "pdf", pages: 22, uploadedBy: "u_02", uploadedAt: "2023-12-20", size: "1.4 MB", hasRedactions: true },
  { id: "b_3", title: "Rush 2023 Playbook",            category: "Rush",     term: "Fall 2023",   type: "pdf", pages: 36, uploadedBy: "u_03", uploadedAt: "2023-11-02", size: "3.8 MB" },
  { id: "b_4", title: "Risk Management Policy (2024)", category: "Policy",   term: "Ongoing",     type: "pdf", pages: 18, uploadedBy: "u_01", uploadedAt: "2024-04-23", size: "0.9 MB" },
  { id: "b_5", title: "Alumni Contact Database",       category: "Alumni",   term: "Ongoing",     type: "sheet", pages: null, uploadedBy: "u_03", uploadedAt: "2024-01-15", size: "—", hasRedactions: true },
  { id: "b_6", title: "New Member Ed Curriculum v4",   category: "Onboarding", term: "Ongoing",   type: "pdf", pages: 52, uploadedBy: "u_07", uploadedAt: "2024-02-10", size: "4.2 MB" },
  { id: "b_7", title: "Philanthropy 5K — Post-Event Recap", category: "Events", term: "Spring 2024", type: "doc", pages: 8, uploadedBy: "u_06", uploadedAt: "2024-05-14", size: "0.4 MB" },
  { id: "b_8", title: "Chapter Bylaws (ratified 2024)", category: "Policy",  term: "Ongoing",     type: "pdf", pages: 24, uploadedBy: "u_01", uploadedAt: "2024-03-01", size: "1.1 MB", pinned: true },
];

const BACKWORK_CATEGORIES = [
  { key: "all", label: "All documents", count: BACKWORK_SEED.length },
  { key: "Meetings", label: "Meetings", count: 1 },
  { key: "Finance", label: "Finance", count: 1 },
  { key: "Rush", label: "Rush", count: 1 },
  { key: "Policy", label: "Policy", count: 2 },
  { key: "Alumni", label: "Alumni", count: 1 },
  { key: "Onboarding", label: "Onboarding", count: 1 },
  { key: "Events", label: "Events", count: 1 },
];

/* ──────────────────────────────────────────────────────────────
   BACKWORK (academic) — new schema. Stored in a bucket IRL.
   Department → Course → ResourceType → Year/Term → File
   ────────────────────────────────────────────────────────────── */

const BW_DEPARTMENTS = [
  { key: "CSCI", label: "Computer Science",   color: "var(--hue-violet)" },
  { key: "MATH", label: "Mathematics",        color: "var(--hue-rose)" },
  { key: "PHYS", label: "Physics",            color: "var(--hue-teal)" },
  { key: "CHEM", label: "Chemistry",          color: "var(--hue-lime)" },
  { key: "ENGR", label: "Engineering",        color: "var(--hue-amber)" },
  { key: "ECON", label: "Economics",          color: "var(--primary)" },
  { key: "ECSE", label: "Electrical & Computer Sys", color: "var(--primary)" },
  { key: "MANE", label: "Mechanical Aero Nuclear",   color: "var(--hue-amber)" },
];

const BW_RESOURCE_TYPES = [
  { key: "exam",     label: "Exams",       icon: "alert",    desc: "Midterms, finals, makeups" },
  { key: "quiz",     label: "Quizzes",     icon: "check",    desc: "In-class & take-home quizzes" },
  { key: "hw",       label: "Homework",    icon: "ledger",   desc: "Problem sets, assignments" },
  { key: "lab",      label: "Labs",        icon: "funnel",   desc: "Lab reports, notebooks" },
  { key: "notes",    label: "Notes",       icon: "pin",      desc: "Lecture notes, summaries" },
  { key: "other",    label: "Other",       icon: "folder",   desc: "Cheat sheets, projects" },
];

const BW_COURSES = [
  { code: "CSCI-1100", dept: "CSCI", title: "Computer Science I",          professor: "Goldschmidt", level: 1000, resourceCount: 34, contributors: 12, popularity: 94 },
  { code: "CSCI-1200", dept: "CSCI", title: "Data Structures",             professor: "Cutler",      level: 1000, resourceCount: 48, contributors: 18, popularity: 98 },
  { code: "CSCI-2200", dept: "CSCI", title: "Foundations of CS",           professor: "Magdon-Ismail", level: 2000, resourceCount: 22, contributors: 9, popularity: 71 },
  { code: "CSCI-2300", dept: "CSCI", title: "Intro to Algorithms",         professor: "Drineas",     level: 2000, resourceCount: 29, contributors: 11, popularity: 84 },
  { code: "CSCI-2600", dept: "CSCI", title: "Principles of Software",      professor: "Milanova",    level: 2000, resourceCount: 17, contributors: 7, popularity: 62 },
  { code: "CSCI-4430", dept: "CSCI", title: "Programming Languages",       professor: "Varela",      level: 4000, resourceCount: 14, contributors: 6, popularity: 48 },
  { code: "MATH-1010", dept: "MATH", title: "Calculus I",                  professor: "Piper",       level: 1000, resourceCount: 56, contributors: 22, popularity: 99 },
  { code: "MATH-1020", dept: "MATH", title: "Calculus II",                 professor: "Piper",       level: 1000, resourceCount: 52, contributors: 19, popularity: 97 },
  { code: "MATH-2010", dept: "MATH", title: "Multivariable Calc & ML Alg", professor: "Kapila",      level: 2000, resourceCount: 31, contributors: 14, popularity: 81 },
  { code: "MATH-2400", dept: "MATH", title: "Differential Equations",      professor: "Kapila",      level: 2000, resourceCount: 27, contributors: 10, popularity: 77 },
  { code: "PHYS-1100", dept: "PHYS", title: "Physics I",                   professor: "Persans",     level: 1000, resourceCount: 38, contributors: 15, popularity: 89 },
  { code: "PHYS-1200", dept: "PHYS", title: "Physics II",                  professor: "Wilke",       level: 1000, resourceCount: 33, contributors: 13, popularity: 85 },
  { code: "CHEM-1100", dept: "CHEM", title: "General Chemistry I",         professor: "Bae",         level: 1000, resourceCount: 24, contributors: 8, popularity: 68 },
  { code: "ECON-1200", dept: "ECON", title: "Intro to Economics",          professor: "Thissen",     level: 1000, resourceCount: 19, contributors: 8, popularity: 64 },
  { code: "ECSE-2610", dept: "ECSE", title: "Computer Components & Ops",   professor: "Connor",      level: 2000, resourceCount: 20, contributors: 9, popularity: 72 },
  { code: "MANE-2220", dept: "MANE", title: "Mechanics of Materials",      professor: "Borca-Tasciuc", level: 2000, resourceCount: 26, contributors: 11, popularity: 79 },
  { code: "ENGR-1100", dept: "ENGR", title: "Engineering Graphics & CAD",  professor: "Anderson",    level: 1000, resourceCount: 12, contributors: 5, popularity: 45 },
];

/* Resources — individual files in the bucket. */
const BW_TERMS = ["Fall 2024", "Spring 2024", "Fall 2023", "Spring 2023", "Fall 2022", "Spring 2022", "Fall 2021"];

function makeBwResource(id, courseCode, type, title, term, professor, uploaderId, opts = {}) {
  return {
    id, courseCode, type, title, term, professor,
    uploaderId, uploadedAt: opts.uploadedAt || "2024-12-15",
    pledgeClass: opts.pledgeClass || "Beta 2023",
    attribution: opts.attribution || "pledge_class", // me | pledge_class | anonymous
    fileType: opts.fileType || "pdf",
    pages: opts.pages || Math.floor(3 + Math.random() * 12),
    size: opts.size || `${(0.4 + Math.random() * 3).toFixed(1)} MB`,
    downloads: opts.downloads ?? Math.floor(Math.random() * 48),
    rating: opts.rating ?? (Math.random() > 0.3 ? +(3.5 + Math.random() * 1.5).toFixed(1) : null),
    ratingCount: opts.ratingCount ?? Math.floor(Math.random() * 20),
    redacted: opts.redacted ?? true,
    solution: opts.solution || false,
    hasAnswerKey: opts.hasAnswerKey || false,
  };
}

const BW_RESOURCES = [
  // CSCI-1200 — very popular course
  makeBwResource("bw_1",  "CSCI-1200", "exam",  "Final Exam",              "Fall 2024", "Cutler",  "u_07", { uploadedAt: "2024-12-20", downloads: 87, rating: 4.8, ratingCount: 23, hasAnswerKey: true, pages: 12 }),
  makeBwResource("bw_2",  "CSCI-1200", "exam",  "Midterm 2",               "Fall 2024", "Cutler",  "u_07", { uploadedAt: "2024-11-10", downloads: 54, rating: 4.6, ratingCount: 18, pages: 8 }),
  makeBwResource("bw_3",  "CSCI-1200", "exam",  "Midterm 1",               "Fall 2024", "Cutler",  "u_05", { uploadedAt: "2024-10-05", downloads: 62, rating: 4.7, ratingCount: 20, pages: 8 }),
  makeBwResource("bw_4",  "CSCI-1200", "exam",  "Final Exam (SOLUTIONS)",  "Spring 2024", "Cutler", "u_06", { uploadedAt: "2024-05-20", downloads: 104, rating: 4.9, ratingCount: 31, solution: true, hasAnswerKey: true, pages: 14 }),
  makeBwResource("bw_5",  "CSCI-1200", "exam",  "Final Exam",              "Fall 2023", "Cutler",  "u_01", { uploadedAt: "2023-12-18", downloads: 42, rating: 4.5, ratingCount: 15, pages: 12, attribution: "anonymous" }),
  makeBwResource("bw_6",  "CSCI-1200", "hw",    "HW 1–5 Bundle",           "Fall 2024", "Cutler",  "u_08", { uploadedAt: "2024-11-02", downloads: 38, rating: 4.3, ratingCount: 11, pages: 42 }),
  makeBwResource("bw_7",  "CSCI-1200", "hw",    "HW 8: Binary Search Trees","Fall 2024","Cutler", "u_14", { uploadedAt: "2024-11-28", downloads: 29, rating: 4.4, ratingCount: 8, pages: 6 }),
  makeBwResource("bw_8",  "CSCI-1200", "lab",   "Lab 4: Inheritance",      "Fall 2024", "Cutler",  "u_14", { uploadedAt: "2024-10-20", downloads: 22, pages: 9 }),
  makeBwResource("bw_9",  "CSCI-1200", "notes", "Ch. 1–8 Study Guide",     "Fall 2024", "Cutler",  "u_05", { uploadedAt: "2024-12-10", downloads: 71, rating: 4.9, ratingCount: 26, pages: 24 }),
  makeBwResource("bw_10", "CSCI-1200", "quiz",  "Quiz 3: Linked Lists",    "Spring 2024", "Cutler", "u_06", { uploadedAt: "2024-03-14", downloads: 18, pages: 3 }),

  // CSCI-1100
  makeBwResource("bw_11", "CSCI-1100", "exam",  "Midterm 1",               "Fall 2024", "Goldschmidt", "u_09", { uploadedAt: "2024-10-12", downloads: 45, rating: 4.5, ratingCount: 14, pages: 7 }),
  makeBwResource("bw_12", "CSCI-1100", "exam",  "Final Exam",              "Fall 2023", "Goldschmidt", "u_14", { uploadedAt: "2023-12-22", downloads: 61, rating: 4.6, ratingCount: 19, pages: 10, attribution: "me" }),
  makeBwResource("bw_13", "CSCI-1100", "hw",    "HW 1–3 Bundle",           "Fall 2024", "Goldschmidt", "u_10", { uploadedAt: "2024-09-28", downloads: 31, pages: 15 }),
  makeBwResource("bw_14", "CSCI-1100", "notes", "Python Cheat Sheet",      "Fall 2024", "Goldschmidt", "u_05", { uploadedAt: "2024-11-05", downloads: 89, rating: 4.8, ratingCount: 28, pages: 4 }),

  // MATH-1010
  makeBwResource("bw_15", "MATH-1010", "exam",  "Final Exam",              "Fall 2024", "Piper",    "u_06", { uploadedAt: "2024-12-17", downloads: 92, rating: 4.7, ratingCount: 29, hasAnswerKey: true, pages: 14 }),
  makeBwResource("bw_16", "MATH-1010", "exam",  "Midterm 1",               "Fall 2024", "Piper",    "u_11", { uploadedAt: "2024-10-14", downloads: 67, rating: 4.6, ratingCount: 22, pages: 6 }),
  makeBwResource("bw_17", "MATH-1010", "exam",  "Midterm 2",               "Fall 2024", "Piper",    "u_08", { uploadedAt: "2024-11-11", downloads: 58, rating: 4.5, ratingCount: 17, pages: 7 }),
  makeBwResource("bw_18", "MATH-1010", "hw",    "HW Week 1–4",             "Fall 2024", "Piper",    "u_13", { uploadedAt: "2024-09-25", downloads: 44, pages: 24 }),
  makeBwResource("bw_19", "MATH-1010", "notes", "Limits & Continuity",     "Fall 2024", "Piper",    "u_05", { uploadedAt: "2024-09-30", downloads: 76, rating: 4.8, ratingCount: 24, pages: 8 }),
  makeBwResource("bw_20", "MATH-1010", "notes", "Integration Techniques",  "Fall 2024", "Piper",    "u_05", { uploadedAt: "2024-11-20", downloads: 84, rating: 4.9, ratingCount: 31, pages: 12 }),
  makeBwResource("bw_21", "MATH-1010", "exam",  "Final Exam",              "Fall 2023", "Piper",    "u_03", { uploadedAt: "2023-12-19", downloads: 38, pages: 14, attribution: "anonymous" }),

  // MATH-1020
  makeBwResource("bw_22", "MATH-1020", "exam",  "Midterm 1",               "Spring 2024", "Piper", "u_14", { uploadedAt: "2024-02-20", downloads: 51, rating: 4.4, ratingCount: 15, pages: 7 }),
  makeBwResource("bw_23", "MATH-1020", "exam",  "Final Exam (w/ SOLUTIONS)", "Spring 2024", "Piper", "u_06", { uploadedAt: "2024-05-15", downloads: 97, rating: 4.9, ratingCount: 32, solution: true, hasAnswerKey: true, pages: 16 }),
  makeBwResource("bw_24", "MATH-1020", "notes", "Series Convergence Tests","Spring 2024", "Piper", "u_06", { uploadedAt: "2024-04-10", downloads: 69, rating: 4.7, ratingCount: 23, pages: 6 }),

  // PHYS-1100
  makeBwResource("bw_25", "PHYS-1100", "exam",  "Final Exam",              "Fall 2024", "Persans",  "u_08", { uploadedAt: "2024-12-15", downloads: 73, rating: 4.6, ratingCount: 20, pages: 11 }),
  makeBwResource("bw_26", "PHYS-1100", "hw",    "HW 1–6",                  "Fall 2024", "Persans",  "u_11", { uploadedAt: "2024-10-30", downloads: 34, pages: 28 }),
  makeBwResource("bw_27", "PHYS-1100", "lab",   "Lab Manual — All Labs",   "Fall 2024", "Persans",  "u_12", { uploadedAt: "2024-09-10", downloads: 58, rating: 4.5, ratingCount: 14, pages: 48 }),

  // CSCI-2300
  makeBwResource("bw_28", "CSCI-2300", "exam",  "Midterm 2 (w/ SOLUTIONS)","Fall 2024", "Drineas",  "u_07", { uploadedAt: "2024-11-15", downloads: 48, rating: 4.8, ratingCount: 17, solution: true, hasAnswerKey: true, pages: 10 }),
  makeBwResource("bw_29", "CSCI-2300", "exam",  "Final Exam",              "Fall 2024", "Drineas",  "u_07", { uploadedAt: "2024-12-16", downloads: 52, rating: 4.7, ratingCount: 19, pages: 13 }),

  // ECSE-2610
  makeBwResource("bw_30", "ECSE-2610", "exam",  "Midterm 1",               "Fall 2024", "Connor",   "u_03", { uploadedAt: "2024-10-08", downloads: 29, pages: 8 }),

  // My pending upload (current user)
  makeBwResource("bw_p1", "CSCI-1200", "hw",    "HW 9: Graphs (my submission)", "Fall 2024", "Cutler", "u_05", { uploadedAt: "2026-04-22", downloads: 0, rating: null, ratingCount: 0, attribution: "me" }),
];

/* Derived — recent uploads and top contributors */
const BW_RECENT = [...BW_RESOURCES]
  .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
  .slice(0, 8);

const BW_TOP_CONTRIBUTORS = (() => {
  const counts = {};
  BW_RESOURCES.forEach(r => {
    if (r.attribution === "anonymous") return;
    counts[r.uploaderId] = (counts[r.uploaderId] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => ({ userId: id, count }));
})();

/* ──────────────────────────────────────────────────────────────
   Rush — candidates + funnel. Proposed schema.
   ────────────────────────────────────────────────────────────── */
const RUSH_STAGES = [
  { key: "interest",  label: "Interest",   desc: "Submitted interest form" },
  { key: "invited",   label: "Invited",    desc: "Invited to rush events" },
  { key: "attending", label: "Attending",  desc: "Showed up ≥ 1 event" },
  { key: "voting",    label: "At vote",    desc: "Presented to chapter" },
  { key: "bid",       label: "Bid given",  desc: "Offered a bid" },
  { key: "pledged",   label: "Pledged",    desc: "Accepted; joined pledge class" },
];

const RUSH_CANDIDATES = [
  ["rc_1", "Ben Carter",        "bcarter@rpi.edu",     "Sophomore", "CS",          "bid",       5, 92, ["u_01","u_03","u_05"], ["Referred by Elena P.", "Captain of ultimate team"]],
  ["rc_2", "Isabel Moreno",     "imoreno@rpi.edu",     "Freshman",  "Aero",        "pledged",   6, 95, ["u_01","u_03","u_06","u_07"], ["Strong letter from alum — Wes H.", "Top of rush cohort"]],
  ["rc_3", "Marcus Okonkwo",    "mokonkwo@rpi.edu",    "Sophomore", "Mech E",      "voting",    4, 78, ["u_03","u_05"], ["Good BBQ, quieter at mixer"]],
  ["rc_4", "Dhruv Patel",       "dpatel@rpi.edu",      "Freshman",  "CS",          "attending", 2, 65, ["u_05"], []],
  ["rc_5", "Wren Holloway",     "whollowa@rpi.edu",    "Freshman",  "IT",          "attending", 3, 71, ["u_07","u_14"], ["Legacy — dad is class of '99"]],
  ["rc_6", "Teddy Raines",      "traines@rpi.edu",     "Sophomore", "Physics",     "invited",   0, null, [], []],
  ["rc_7", "Luca Fontaine",     "lfontai@rpi.edu",     "Freshman",  "EE",          "invited",   0, null, [], []],
  ["rc_8", "Santi Reyes",       "sreyes@rpi.edu",      "Sophomore", "Arch",        "interest",  0, null, [], []],
  ["rc_9", "August Kim",        "akim2@rpi.edu",       "Freshman",  "Biz",         "interest",  0, null, [], []],
  ["rc_10","Rohan Desai",       "rdesai@rpi.edu",      "Freshman",  "CS",          "interest",  0, null, [], []],
  ["rc_11","Elliot Vance",      "evance@rpi.edu",      "Sophomore", "Design",      "voting",    4, 81, ["u_03","u_06"], ["Really sharp at BBQ"]],
  ["rc_12","Jonah Briar",       "jbriar@rpi.edu",      "Freshman",  "CS",          "bid",       5, 88, ["u_01","u_05"], ["Legacy candidate"]],
].map(([id, name, email, year, major, stage, eventsAttended, avgScore, referrers, flags]) => ({
  id, name, email, year, major, stage, eventsAttended, avgScore, referrers, flags,
  hue: `hsl(${(id.charCodeAt(3) * 67) % 360} 35% 55%)`,
  initials: name.split(" ").map(p => p[0]).slice(0,2).join(""),
  addedAt: "2026-04-10",
}));

/* ──────────────────────────────────────────────────────────────
   Billing — invoices + plans. Matches billing route schemas where possible.
   ────────────────────────────────────────────────────────────── */
const INVOICES_SEED = [
  { id: "inv_q2_2026", label: "Q2 2026 Dues", term: "Spring 2026", amount: 850, issuedAt: "2026-04-01", dueAt: "2026-05-15", appliesTo: "all_active" },
];

const DUES_STATUS = [
  ["u_01", "paid",        850, "2026-04-12", null,            null],
  ["u_02", "paid",        850, "2026-04-02", null,            null],
  ["u_03", "paid",        850, "2026-04-14", null,            null],
  ["u_04", "paid",        850, "2026-04-18", null,            null],
  ["u_05", "paid",        850, "2026-04-20", null,            null],
  ["u_06", "plan",        850, null, "2026-06-15",  "3 installments of $283.33"],
  ["u_07", "paid",        850, "2026-04-08", null,            null],
  ["u_08", "pending",     850, null, "2026-05-15",  null],
  ["u_09", "paid",        425, "2026-04-05", null,            "New member half-rate"],
  ["u_10", "paid",        425, "2026-04-05", null,            "New member half-rate"],
  ["u_11", "plan",        425, null, "2026-07-01",  "4 installments"],
  ["u_12", "overdue",     425, null, "2026-04-15",  null],
  ["u_13", "paid",        425, "2026-04-11", null,            null],
  ["u_14", "pending",     850, null, "2026-05-15",  null],
  ["u_15", "exempt",        0, null, null,         "Alumnus — no dues"],
  ["u_16", "partial",     850, "2026-04-20", "2026-05-15",    "Paid $400 / $850"],
].map(([userId, status, amount, paidAt, dueAt, note]) => ({
  userId, status, amount, paidAt, dueAt, note,
  paidAmount: status === "paid" ? amount : status === "partial" ? 400 : 0,
}));

/* ──────────────────────────────────────────────────────────────
   Service hours — approval queue. Proposed schema (api/routes/hours).
   ────────────────────────────────────────────────────────────── */
const HOURS_LOG = [
  { id: "h_1", userId: "u_09", hours: 3, category: "Service",      description: "Beach cleanup — Half Moon Bay", at: "2026-04-18", eventId: "e_02", status: "approved",  approvedBy: "u_06", approvedAt: "2026-04-18T15:00:00" },
  { id: "h_2", userId: "u_10", hours: 3, category: "Service",      description: "Beach cleanup — Half Moon Bay", at: "2026-04-18", eventId: "e_02", status: "approved",  approvedBy: "u_06", approvedAt: "2026-04-18T15:00:00" },
  { id: "h_3", userId: "u_11", hours: 2, category: "Philanthropy", description: "5K volunteer planning meeting", at: "2026-04-20", eventId: null,   status: "pending",   receipt: "photo attached" },
  { id: "h_4", userId: "u_09", hours: 4, category: "Service",      description: "Tutoring at Boys & Girls Club (self-reported)", at: "2026-04-21", eventId: null, status: "pending", receipt: "signed slip" },
  { id: "h_5", userId: "u_13", hours: 2, category: "Philanthropy", description: "Designed 5K race flyer", at: "2026-04-22", eventId: null,   status: "pending",   receipt: "file link" },
  { id: "h_6", userId: "u_12", hours: 6, category: "Service",      description: "Food bank — 4am to 10am", at: "2026-04-19", eventId: null,   status: "rejected",  rejectedBy: "u_06", rejectedAt: "2026-04-20T09:00:00", rejectReason: "Hours too high for documented time window — resubmit with sign-in sheet" },
  { id: "h_7", userId: "u_05", hours: 1.5, category: "Service",    description: "Campus cleanup — earth day", at: "2026-04-22", eventId: null,   status: "pending" },
];

const HOURS_REQUIREMENTS = {
  newmember: { required: 10, term: "Spring 2026" },
  member:    { required: 6,  term: "Spring 2026" },
};

/* ──────────────────────────────────────────────────────────────
   Reports — aggregate health metrics. Synthesized from above.
   ────────────────────────────────────────────────────────────── */
const REPORT_HEALTH = {
  termLabel: "Spring 2026",
  duesCollection: { collected: 10625, target: 12750, memberCount: 16, paidCount: 10, onPlan: 2, overdue: 1 },
  attendance:     { rate: 0.82, mandatoryRate: 0.94, socialRate: 0.71, last4: [0.78, 0.81, 0.88, 0.82] },
  serviceHours:   { total: 128, target: 180, memberAvg: 8.0, laggingCount: 3 },
  retention:      { active: 84, semAgo: 88, yearAgo: 81 },
  newMembers:     { cohort: 5, onTrack: 3, atRisk: 2, weeksIn: 4, weeksTotal: 8 },
};

/* ──────────────────────────────────────────────────────────────
   Onboarding pathway — proposed schema shape. Flagged in UI.
   ────────────────────────────────────────────────────────────── */
const ONBOARDING_PATHWAY = {
  id: "path_gamma_2024",
  name: "Gamma 2024 — New Member Ed",
  totalWeeks: 8,
  currentWeek: 4,
  milestones: [
    { id: "ms_1", week: 1, title: "Bid acceptance & signing",        status: "done", kind: "form" },
    { id: "ms_2", week: 2, title: "Ritual primer (session 1)",      status: "done", kind: "event", eventId: "e_04" },
    { id: "ms_3", week: 3, title: "Big/Little pairing",              status: "done", kind: "pairing" },
    { id: "ms_4", week: 4, title: "Values discussion (session 4)",   status: "current", kind: "event", eventId: "e_04" },
    { id: "ms_5", week: 5, title: "Service hours (3 min)",           status: "upcoming", kind: "goal", target: 3 },
    { id: "ms_6", week: 6, title: "Chapter history quiz",            status: "upcoming", kind: "quiz" },
    { id: "ms_7", week: 7, title: "Leadership interview",            status: "upcoming", kind: "meeting" },
    { id: "ms_8", week: 8, title: "Initiation ceremony",             status: "upcoming", kind: "ritual" },
  ],
  newMembers: ["u_09","u_10","u_11","u_12","u_13"],
};

/* ──────────────────────────────────────────────────────────────
   claude.complete wiring — generate fresh fixtures on demand
   ────────────────────────────────────────────────────────────── */
async function aiGenerate(prompt, { fallback, parseJson = true } = {}) {
  if (typeof window.claude === "undefined" || !window.claude.complete) {
    return fallback;
  }
  try {
    const text = await window.claude.complete(prompt);
    if (!parseJson) return text;
    const match = text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn("aiGenerate failed, using fallback", e);
    return fallback;
  }
}

/* ──────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────── */
const byId = (list) => Object.fromEntries(list.map(x => [x.id, x]));
const MEMBERS_BY_ID = byId(MEMBERS_SEED);
const EVENTS_BY_ID = byId(EVENTS_SEED);

const memberOf = (id) => MEMBERS_BY_ID[id] || { name: "Unknown", initials: "?", hue: "var(--fg-muted)" };

function formatRelativeTime(iso) {
  const now = new Date("2026-04-23T18:00:00");
  const d = new Date(iso);
  const diff = (d - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "now";
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h`;
  if (abs < 604800) return `${Math.round(abs / 86400)}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatEventTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

Object.assign(window, {
  ROLES, CAPS, hasCap,
  CURRENT_USERS, CHAPTER, NAV_CONFIG,
  MEMBERS_SEED, MEMBERS_BY_ID, memberOf,
  EVENTS_SEED, EVENTS_BY_ID,
  CHANNELS_SEED, MESSAGES_SEED,
  TASKS_SEED, POINTS_LEDGER,
  BACKWORK_SEED, BACKWORK_CATEGORIES,
  BW_DEPARTMENTS, BW_RESOURCE_TYPES, BW_COURSES, BW_RESOURCES, BW_TERMS, BW_RECENT, BW_TOP_CONTRIBUTORS,
  ONBOARDING_PATHWAY,
  RUSH_STAGES, RUSH_CANDIDATES,
  INVOICES_SEED, DUES_STATUS,
  HOURS_LOG, HOURS_REQUIREMENTS,
  REPORT_HEALTH,
  aiGenerate,
  formatRelativeTime, formatEventTime, formatTime, formatDate,
});
