import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolsMemberMayUse } from '../../ask-tool';
import type { AgentReadTool } from '../agent-tool';
import { CHAPTER_AGENT_TOOLS } from './index';

/**
 * The rules every chapter tool keeps (`../agent-tool.ts`, #4901), checked on
 * the list the module provides, so a tool added to it is held to them.
 */
const tools = CHAPTER_AGENT_TOOLS.map(
  (Tool) =>
    new (Tool as unknown as new (...services: never[]) => AgentReadTool)(),
);
const byName = new Map(tools.map((tool) => [tool.name, tool]));

/**
 * The route each tool mirrors: its permission and its module. Written out,
 * not read back from the tool, so loosening a tool fails here until someone
 * reads the route again.
 */
const GATES: Record<string, { permission: string; module: string | null }> = {
  find_member: { permission: 'members:view', module: null },
  roster: { permission: 'members:view', module: null },
  my_tasks: { permission: 'members:view', module: 'tasks' },
  chapter_tasks: { permission: 'tasks:manage', module: 'tasks' },
  events: { permission: 'members:view', module: 'events' },
  open_event: { permission: 'members:view', module: 'events' },
  my_attendance: { permission: 'members:view', module: 'events' },
  event_attendance: { permission: 'events:update', module: 'events' },
  attendance_summary: { permission: 'events:update', module: 'events' },
  my_standing: { permission: 'members:view', module: null },
  my_points: { permission: 'members:view', module: 'points' },
  points_standings: { permission: 'members:view', module: 'points' },
  my_hours: { permission: 'members:view', module: 'hours' },
  service_hours: { permission: 'members:view', module: 'hours' },
  my_dues: { permission: 'members:view', module: 'dues' },
};

const ALL_ON = {
  tasks: true,
  events: true,
  points: true,
  hours: true,
  dues: true,
};

describe('Chapter agent tools', () => {
  it('every tool is a read with a name, a permission and words for the working line', () => {
    expect(tools.length).toBeGreaterThan(0);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.effect).toBe('read');
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.reading.length).toBeGreaterThan(0);
      expect(tool.permission.length).toBeGreaterThan(0);
    }
  });

  it('every tool has the gate of the route it mirrors', () => {
    expect(
      Object.fromEntries(
        tools.map((tool) => [
          tool.name,
          { permission: tool.permission, module: tool.module },
        ]),
      ),
    ).toEqual(GATES);
  });

  it('a member is offered only the tools their role and chapter allow', () => {
    const offered = (permissions: string[], modules: Record<string, boolean>) =>
      toolsMemberMayUse(tools, new Set(permissions), modules).map(
        (tool) => tool.name,
      );
    // An ordinary member: nothing about other members' tasks or attendance.
    const member = offered(['members:view'], ALL_ON);
    expect(member).not.toContain('chapter_tasks');
    expect(member).not.toContain('event_attendance');
    expect(member).not.toContain('attendance_summary');
    expect(member).toContain('my_tasks');
    // A committee chair who runs events, and an officer who manages tasks.
    expect(offered(['members:view', 'events:update'], ALL_ON)).toEqual(
      expect.arrayContaining(['event_attendance', 'attendance_summary']),
    );
    expect(offered(['members:view', 'tasks:manage'], ALL_ON)).toContain(
      'chapter_tasks',
    );
    // A module the chapter has off takes its tools with it, whoever asks.
    const eventsOff = offered(['*'], { ...ALL_ON, events: false });
    expect(eventsOff).toEqual(
      expect.not.arrayContaining([
        'events',
        'open_event',
        'my_attendance',
        'event_attendance',
        'attendance_summary',
      ]),
    );
    expect(eventsOff).toContain('chapter_tasks');
    // Someone who cannot open the roster is offered nothing at all.
    expect(offered([], ALL_ON)).toEqual([]);
  });

  it.each(tools.map((tool) => [tool.name, tool]))(
    '%s takes no argument it has no default for, and describes each one',
    (_name, tool) => {
      // The model may call any tool with nothing; the defaults fill it in.
      const parsed = tool.input.safeParse({});
      expect(parsed.success).toBe(true);
      const shape = (
        tool.input as unknown as {
          shape: Record<string, { description?: string }>;
        }
      ).shape;
      for (const [key, field] of Object.entries(shape)) {
        expect(`${key}: ${field.description ?? ''}`).toMatch(/^\w+: .{20,}/);
        // Flat: strings, numbers and enums only.
        expect(['string', 'number']).toContain(
          typeof (parsed.data as Record<string, unknown>)[key],
        );
      }
    },
  );

  it('no tool takes a chapter or a member id from the model', () => {
    for (const tool of tools) {
      const shape = (tool.input as unknown as { shape: object }).shape;
      expect(
        Object.keys(shape).filter((key) =>
          /chapter|user_id|member_id/.test(key),
        ),
      ).toEqual([]);
    }
  });

  it('a day that is not a day never reaches a tool', () => {
    const events = byName.get('events')!;
    expect(events.input.safeParse({ from: 'next week' }).success).toBe(false);
    expect(events.input.safeParse({ from: '2026-11-01' }).success).toBe(true);
    expect(
      byName.get('points_standings')!.input.safeParse({ places: 5000 }).success,
    ).toBe(false);
  });
});

/**
 * A tool changes nothing. Checked on the sources, like
 * `../../ask-posts-nothing.spec.ts` checks Ask's own lanes (which does not
 * read this folder): every call a tool makes on a service it holds is on the
 * list below, and each one on the list is a read. A new call fails here
 * until someone reads what it does.
 *
 * What this does not see: a call on a service passed as an argument.
 * `findEvent` (`event-lines.ts`) is the one place that happens, and it makes
 * two reads, `events.findByChapter` and `events.findById`.
 */
const READS = new Set([
  'attendance.getAttendance',
  'attendance.getMyAttendance',
  'attendance.getMyAttendanceForEvents',
  'events.findByChapter',
  'excuses.getMine',
  'groups.list',
  'invoices.findByUser',
  'members.findByUserAndChapter',
  'members.findProfilesByChapter',
  'members.findRosterByChapter',
  'members.searchByChapterAndName',
  'points.getLeaderboard',
  'points.getUserSummary',
  'rbac.findByChapter',
  'rbac.getAlumniRoleId',
  'service.findByChapterFiltered',
  'service.leaderboard',
  'standing.getStanding',
  'tasks.list',
]);

/** Modules that write: a tool file must not even import one. */
const WRITERS = [
  /\/chat\.service'/,
  /\/notification\.service'/,
  /\/study\.service'/,
  /repository\.interface'/,
  /infrastructure\//,
];

describe('A chapter tool changes nothing', () => {
  const sources = readdirSync(__dirname)
    .filter((name) => name.endsWith('.ts') && !name.includes('.spec.'))
    .map((name) => ({
      name,
      text: readFileSync(join(__dirname, name), 'utf8'),
    }));
  const callsIn = (text: string) =>
    [...text.matchAll(/\bthis\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g)].map(
      (match) => `${match[1]}.${match[2]}`,
    );

  it('reads its own sources', () => {
    expect(sources.map((source) => source.name)).toContain('roster.tool.ts');
  });

  it.each(sources.map((source) => [source.name, source.text]))(
    '%s calls only listed reads and imports nothing that writes',
    (name, text) => {
      // Only a tool holds services; the helpers beside them hold none, and
      // their `this.` calls are on their own maps.
      if (name.endsWith('.tool.ts')) {
        expect(callsIn(text).filter((call) => !READS.has(call))).toEqual([]);
      }
      const imports = text.split('\n').filter((line) => /\bfrom '/.test(line));
      for (const writer of WRITERS) {
        expect(imports.filter((line) => writer.test(line))).toEqual([]);
      }
    },
  );

  it('lists no read the tools no longer make', () => {
    const made = new Set(sources.flatMap((source) => callsIn(source.text)));
    expect([...READS].filter((call) => !made.has(call))).toEqual([]);
  });
});
