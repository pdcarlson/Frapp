import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { askStepKind, askStepPast } from '@repo/validation';
import type { AgentSource } from './agent-tool';
import { askStepEnded } from './agent-step';

const message = (id: string, channel: string): AgentSource => ({
  id: `message:${id}`,
  kind: 'chat',
  title: `#${channel}`,
  detail: 'Sam Park',
  date: '2026-11-10T15:00:00.000Z',
  target: { type: 'message', channel_id: channel, message_id: id },
  text: 'Sam Park in #general: the budget is $4,200',
  chat: true,
  authorIds: ['sam'],
});

const passage = (id: string, title: string): AgentSource => ({
  id,
  kind: 'document',
  title,
  detail: null,
  date: null,
  target: null,
  text: 'Article IV: dues are set each spring.',
  chat: false,
  authorIds: [],
});

const titleOf = (source: AgentSource) => source.title;

describe('askStepEnded (#5427)', () => {
  it('counts messages and names the channel, never a line of what was said', () => {
    const step = askStepEnded(
      {
        type: 'read',
        call: 3,
        name: 'search_messages',
        outcome: 'ok',
        sources: [
          message('m1', 'exec-board'),
          message('m2', 'exec-board'),
          message('m3', 'exec-board'),
        ],
      },
      titleOf,
    );

    expect(step).toEqual({
      type: 'step',
      call: 3,
      tool: 'search_messages',
      kind: 'chat',
      outcome: 'found',
      found: 3,
      names: ['#exec-board'],
    });
    expect(JSON.stringify(step)).not.toContain('budget');
    expect(JSON.stringify(step)).not.toContain('Sam');
  });

  it('counts a document once however many passages matched, and names at most three', () => {
    const step = askStepEnded(
      {
        type: 'read',
        call: 1,
        name: 'search_records',
        outcome: 'ok',
        sources: [
          passage('document:d1:1', 'Bylaws'),
          passage('document:d1:2', 'Bylaws'),
          passage('document:d2:1', 'Budget 2026'),
          passage('document:d3:1', 'Risk policy'),
          passage('document:d4:1', 'House rules'),
        ],
      },
      titleOf,
    );

    expect(step.found).toBe(4);
    expect(step.names).toEqual(['Bylaws', 'Budget 2026', 'Risk policy']);
    expect(step.outcome).toBe('found');
    expect(JSON.stringify(step)).not.toContain('Article IV');
  });

  it('says nothing was found, or that the read failed, with no names', () => {
    expect(
      askStepEnded(
        { type: 'read', call: 1, name: 'events', outcome: 'ok', sources: [] },
        titleOf,
      ),
    ).toMatchObject({ outcome: 'nothing', found: 0, names: [] });
    expect(
      askStepEnded(
        {
          type: 'read',
          call: 2,
          name: 'read_channel',
          outcome: 'timed_out',
          sources: [message('m1', 'general')],
        },
        titleOf,
      ),
    ).toMatchObject({ outcome: 'failed', found: 0, names: [] });
  });

  it('gives a tool this build has no kind for the plain mark', () => {
    expect(
      askStepEnded(
        { type: 'read', call: 1, name: 'new_tool', outcome: 'ok', sources: [] },
        titleOf,
      ).kind,
    ).toBe('other');
  });
});

describe('every read tool, as a step (#5427)', () => {
  // Read from the tool files themselves, so a tool added later is held to it.
  const dirs = ['tools-conversations', 'tools-chapter'].map((dir) =>
    join(__dirname, dir),
  );
  const tools = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith('.tool.ts'))
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .flatMap((text) => {
        const name = /readonly name = '([^']+)'/.exec(text)?.[1];
        const reading = /readonly reading = ['"]([^'"]+)['"]/.exec(text)?.[1];
        return name && reading ? [{ name, reading }] : [];
      }),
  );

  it('finds the tools', () => {
    expect(tools.length).toBeGreaterThan(20);
  });

  it.each(tools.map((tool) => [tool.name, tool.reading]))(
    '%s has an icon and its words a past tense',
    (name, reading) => {
      expect(askStepKind(name)).not.toBe('other');
      expect(askStepPast(reading)).not.toBe(reading);
    },
  );
});
