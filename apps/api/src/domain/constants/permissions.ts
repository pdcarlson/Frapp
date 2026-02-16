export const PERMISSIONS = {
  // Events
  EVENTS_CREATE: 'events:create',
  EVENTS_UPDATE: 'events:update',
  EVENTS_DELETE: 'events:delete',
  EVENTS_VIEW: 'events:view',

  // Financials
  FINANCIALS_CREATE_INVOICE: 'financials:create_invoice',
  FINANCIALS_VIEW_ALL: 'financials:view_all',

  // Members
  MEMBERS_INVITE: 'members:invite',
  MEMBERS_REMOVE: 'members:remove',
  MEMBERS_MANAGE_ROLES: 'members:manage_roles',

  // Roles
  ROLES_MANAGE: 'roles:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
