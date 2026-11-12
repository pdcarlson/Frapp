import type { ActPlan } from './act-prompt';
import type { ActToolContext } from './act-tool';

/** Shared by the acting agent's specs. Not product code. */

export const CHAPTER = '11111111-1111-4111-8111-111111111111';
export const OFFICER = '22222222-2222-4222-8222-222222222222';
export const JORDAN = '33333333-3333-4333-8333-333333333333';
export const JACOB = '44444444-4444-4444-8444-444444444444';
export const SAM = '55555555-5555-4555-8555-555555555555';
export const SAM_TWO = '66666666-6666-4666-8666-666666666666';
export const OUTSIDER = '77777777-7777-4777-8777-777777777777';
export const NOW = new Date('2026-11-12T23:00:00.000Z');
export const ZONE = 'America/New_York';

export function plan(overrides: Partial<ActPlan> = {}): ActPlan {
  return {
    action: 'none',
    people: [],
    everyone_who_attended: false,
    event_name: null,
    date: null,
    start_time: null,
    end_time: null,
    amount: null,
    title: null,
    details: null,
    location: null,
    required: null,
    ...overrides,
  };
}

export function toolContext(
  permissions: readonly string[],
  overrides: Partial<ActToolContext> = {},
): ActToolContext {
  return {
    chapterId: CHAPTER,
    userId: OFFICER,
    now: NOW,
    timeZone: ZONE,
    heldPermissions: new Set(permissions),
    enabledModules: null,
    ...overrides,
  };
}

/** A roster row with the fields the resolver reads. */
export function profile(
  userId: string,
  name: string,
  roleIds: string[] = [],
): {
  user_id: string;
  display_name: string;
  role_ids: string[];
  custom_role_ids: string[];
} {
  return {
    user_id: userId,
    display_name: name,
    role_ids: roleIds,
    custom_role_ids: [],
  };
}
