import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Who each tool says may open what it read, pinned (#4713, #4899).
 *
 * A tool that says nothing fails safe: the asker is warned before the answer
 * goes to a channel. One that says too much does not fail at all: the
 * asker's dues marked `chapter` would be posted with no warning and every
 * other test would pass. So the audience each tool file names is listed
 * here, and changing one means reading the route it mirrors first
 * (`AgentSourceAudience` in `agent-tool.ts`).
 */
const AUDIENCES: Record<string, string[]> = {
  // Anyone who holds `members:view` reads the same rows.
  'tools-chapter/roster.tool.ts': ['chapter'],
  'tools-chapter/find-member.tool.ts': ['chapter'],
  'tools-chapter/points-standings.tool.ts': ['chapter'],
  'tools-chapter/events.tool.ts': ['events'],
  // The asker's own records.
  'tools-chapter/my-attendance.tool.ts': ['asker'],
  'tools-chapter/my-dues.tool.ts': ['asker'],
  'tools-chapter/my-hours.tool.ts': ['asker'],
  'tools-chapter/my-points.tool.ts': ['asker'],
  'tools-chapter/my-standing.tool.ts': ['asker'],
  'tools-chapter/my-tasks.tool.ts': ['asker', 'asker'],
  'tools-chapter/open-event.tool.ts': ['asker'],
  'tools-conversations/list-channels.tool.ts': ['asker'],
  // A record, asked about by its id.
  'tools-conversations/list-meetings.tool.ts': ['meeting'],
  'tools-conversations/read-minutes.tool.ts': ['meeting'],
  'tools-conversations/search-records.tool.ts': [
    "minutes ? 'meeting' : 'document'",
  ],
  // What an officer permission gates says nothing, and so always warns.
  'tools-chapter/attendance-summary.tool.ts': [],
  'tools-chapter/chapter-tasks.tool.ts': [],
  'tools-chapter/event-attendance.tool.ts': [],
  'tools-chapter/service-hours.tool.ts': [],
  // Chat is refused outright, and a document is read through
  // `recordSource` in `search-records.tool.ts`.
  'tools-conversations/read-channel.tool.ts': [],
  'tools-conversations/read-document.tool.ts': [],
  'tools-conversations/search-messages.tool.ts': [],
};

describe('who a tool says may open its sources', () => {
  const files = ['tools-chapter', 'tools-conversations'].flatMap((folder) =>
    readdirSync(join(__dirname, folder))
      .filter((file) => file.endsWith('.tool.ts'))
      .map((file) => `${folder}/${file}`),
  );

  it('lists every tool file', () => {
    expect(files.sort()).toEqual(Object.keys(AUDIENCES).sort());
  });

  it.each(files)('%s', (file) => {
    const named = [
      ...readFileSync(join(__dirname, file), 'utf8').matchAll(
        /audience:\s*\{\s*type:\s*(?:'(\w+)'|([^,]+)),?/g,
      ),
    ].map((match) => match[1] ?? match[2].trim());
    expect(named).toEqual(AUDIENCES[file]);
  });
});
