import type {
  AgentToolContext,
  AgentToolResult,
} from '../../src/application/services/ask/agent/agent-tool';

/** What the agent tool specs share (#4901): an asker, and how a result is read. */

export function askerContext(
  over: Partial<AgentToolContext> = {},
): AgentToolContext {
  return {
    chapterId: 'chapter-a',
    userId: 'user-1',
    // Thursday, November 12, 2026 at 1:00 PM in New York.
    now: new Date('2026-11-12T18:00:00.000Z'),
    timeZone: 'America/New_York',
    permissions: new Set(['members:view']),
    enabledModules: null,
    ...over,
  };
}

/** The one source's text, line by line. Fails when there is not exactly one. */
export function linesOf(result: AgentToolResult): string[] {
  if (result.sources.length !== 1) {
    throw new Error(`expected one source, got ${result.sources.length}`);
  }
  return result.sources[0].text.split('\n');
}

/** Words that must never be in a result: the contact details of the fixtures. */
export const CONTACT_DETAILS = [
  'example.com',
  '555-0100',
  'Troy',
  'Acme',
  '12 Elm Street',
];

/** A profile with every contact detail a real one carries. */
export function profile(over: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    user_id: 'user-1',
    chapter_id: 'chapter-a',
    display_name: 'Dana Reyes',
    email: 'dana@example.com',
    phone: '518-555-0100',
    current_city: 'Troy',
    current_company: 'Acme',
    bio: 'Lives at 12 Elm Street',
    major: 'Physics',
    graduation_year: 2027,
    role_ids: [],
    custom_role_ids: [],
    is_alumni: false,
    ...over,
  };
}
