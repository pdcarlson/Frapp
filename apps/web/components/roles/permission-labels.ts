/**
 * What a permission lets a role do, in words a chapter president reads.
 *
 * The catalog (`GET /v1/roles/permissions-catalog`) carries the API constant's
 * name (`EVENTS_CREATE`) and the permission string (`events:create`), and the
 * roles matrix printed the first: a grid of SCREAMING_SNAKE rows on the one
 * screen where an officer decides who can do what. These follow the "Grants"
 * column of `spec/behavior/rbac.md`'s catalog table, shortened to a row label.
 *
 * A permission this map doesn't know (a chapter's custom string, or a catalog
 * entry added later) reads from its own string instead, `"fines:waive"` as
 * "Waive fines", so a new row is never blank or a constant.
 */
const LABELS: Record<string, string> = {
  "events:create": "Create events",
  "events:update": "Edit events",
  "events:delete": "Delete events",
  "members:invite": "Invite members",
  "members:remove": "Remove members",
  "members:view": "See the full directory",
  "points:adjust": "Add or remove points",
  "points:view_all": "See every member's points",
  "roles:manage": "Manage roles",
  "channels:create": "Create channels",
  "channels:manage": "Manage channels and pins",
  "announcements:post": "Post announcements",
  "alumni:post": "Post in the alumni channel",
  "billing:view": "See billing",
  "billing:manage": "Manage billing and invoices",
  "backwork:upload": "Upload backwork",
  "backwork:admin": "Manage backwork",
  "geofences:manage": "Manage study zones",
  "polls:create": "Create polls",
  "polls:view_all": "See every poll",
  "tasks:manage": "Manage tasks",
  "chapter_docs:upload": "Upload documents",
  "chapter_docs:manage": "Manage documents",
  "service:log": "Log service hours",
  "service:approve": "Approve service hours",
  "semester:rollover": "Start a new semester",
  "reports:export": "Export reports",
  "chapter-config:view": "See chapter settings",
  "chapter-config:manage": "Change chapter settings",
  "chapter-directory:search": "Search the chapter directory",
};

function words(text: string): string {
  return text.replace(/[-_]/g, " ").trim();
}

export function permissionLabel(permission: string): string {
  const known = LABELS[permission];
  if (known) return known;
  const colon = permission.indexOf(":");
  if (colon === -1) {
    const plain = words(permission);
    return plain.charAt(0).toUpperCase() + plain.slice(1);
  }
  const subject = words(permission.slice(0, colon));
  const action = words(permission.slice(colon + 1));
  if (!action) return subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${subject}`;
}
