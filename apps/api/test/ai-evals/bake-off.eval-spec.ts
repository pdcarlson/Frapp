/**
 * The bake-off harness and the synthetic chapter, held to their own rules
 * (#4311). Nothing here calls a model: the scripted candidate runs every
 * task end to end, which proves the path, the grading and the table, and the
 * graders get a direct negative test for each rule.
 */
import { candidateRegistry } from './bake-off/candidate-registry';
import {
  BAKE_OFF_CANDIDATES,
  costUsd,
  findCandidate,
  priceOn,
} from './bake-off/candidates';
import { formatBakeOff, runBakeOff } from './bake-off/run';
import { BAKE_OFF_TASKS, __testing } from './bake-off/tasks';
import {
  CHAT_MESSAGES,
  MEETING_NOTES_CASES,
  PLANTED_MESSAGES,
  ROSTER,
  SYNTHETIC_ASK_CASES,
  SYNTHETIC_CHAPTER_NAME,
  SYNTHETIC_CORPUS,
  channelsFor,
  member,
} from './synthetic-chapter';

const { gradeItems, compliantMinutes, compliantTasks } = __testing;

describe('the bake-off, run with the scripted candidate', () => {
  it.each(BAKE_OFF_TASKS.map((task) => [task.name] as const))(
    '%s passes every case and prints the table',
    async (taskName) => {
      const run = await runBakeOff({
        task: taskName,
        models: ['scripted'],
        env: {},
        date: '2026-11-12',
      });
      const [result] = run.results;
      expect(result.failures).toEqual({});
      expect(result.passed).toBe(result.cases);
      expect(result.cases).toBeGreaterThan(0);
      expect(result.calls).toBeGreaterThan(0);
      expect(result.inputTokens).toBeGreaterThan(0);

      const table = formatBakeOff(run);
      expect(table).toContain(
        '| Model | Pass rate | Citation precision | Refusal rate | Latency p50 / p95 | Tokens in / out | Est. cost |',
      );
      expect(table).toContain('`scripted`');
    },
  );

  it('keeps every source and note out of the table', async () => {
    const tables = await Promise.all(
      BAKE_OFF_TASKS.map(async (task) =>
        formatBakeOff(
          await runBakeOff({
            task: task.name,
            models: ['scripted'],
            env: {},
            date: '2026-11-12',
          }),
        ),
      ),
    );
    const all = tables.join('\n');
    for (const planted of PLANTED_MESSAGES)
      expect(all).not.toContain(planted.body);
    for (const notes of MEETING_NOTES_CASES) {
      for (const line of notes.notes.split('\n'))
        expect(all).not.toContain(line);
    }
  });

  it('counts the scripted model’s fabricated quotes against its precision', async () => {
    // The scripted Ask model adds a made-up quote to every answer, so its
    // precision is well under 100%: the column measures what came back,
    // before the gateway dropped anything.
    const run = await runBakeOff({
      task: 'ask.answer',
      models: ['scripted'],
      env: {},
      date: '2026-11-12',
    });
    expect(run.results[0].citationPrecision).toBeLessThan(0.5);
  });

  it('refuses a name it does not know before running anything', async () => {
    await expect(
      runBakeOff({
        task: 'ask.answer',
        models: ['scripted', 'gpt-x'],
        env: {},
      }),
    ).rejects.toThrow('Unknown bake-off model "gpt-x"');
    await expect(
      runBakeOff({ task: 'minutes.vibes', models: ['scripted'], env: {} }),
    ).rejects.toThrow('Unknown bake-off task "minutes.vibes"');
  });
});

describe('paid candidates', () => {
  it('are never built without AI_EVALS_ALLOW_PAID=1', () => {
    for (const candidate of BAKE_OFF_CANDIDATES.filter((c) => c.paid)) {
      expect(() =>
        candidateRegistry(
          candidate,
          {},
          { ANTHROPIC_API_KEY: 'unit-test-value' },
        ),
      ).toThrow('AI_EVALS_ALLOW_PAID=1');
    }
  });

  it('name the credentials they need when allowed but not configured', () => {
    expect(() =>
      candidateRegistry(
        findCandidate('gemini-3.8-flash'),
        {},
        {
          AI_EVALS_ALLOW_PAID: '1',
        },
      ),
    ).toThrow('GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_CREDENTIALS_JSON');
    expect(() =>
      candidateRegistry(
        findCandidate('claude-haiku-5-5'),
        {},
        {
          AI_EVALS_ALLOW_PAID: '1',
        },
      ),
    ).toThrow('ANTHROPIC_API_KEY');
  });

  it('take the price in force on the run’s date', () => {
    const flash = findCandidate('gemini-3.8-flash');
    expect(priceOn(flash, '2026-11-12').inputUsdPerMillionTokens).toBe(0.75);
    expect(priceOn(flash, '2027-01-01').inputUsdPerMillionTokens).toBe(1.5);
    expect(
      costUsd(priceOn(findCandidate('claude-sonnet-5-5'), '2026-11-12'), {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(3);
  });
});

describe('the minutes and task graders', () => {
  const chapter = MEETING_NOTES_CASES.find(
    (c) => c.id === 'notes-chapter-2026-10-19',
  );
  if (!chapter) throw new Error('missing the chapter meeting notes');
  const tasks = compliantTasks(chapter).tasks.map((t) => ({
    text: t.title,
    owner: t.owner,
    quote: t.quote,
  }));
  const rulesFor = (items: typeof tasks): string[] =>
    gradeItems('task', chapter.actionItems, items, chapter.notes).map(
      (v) => v.rule,
    );

  it('accepts the compliant drafts', () => {
    expect(rulesFor(tasks)).toEqual([]);
    expect(compliantMinutes(chapter).decisions).toHaveLength(2);
  });

  it('flags a guessed owner where two members share the first name', () => {
    const guessed = tasks.map((t) =>
      t.text.includes('bibs') ? { ...t, owner: 'Jordan Pike' } : t,
    );
    expect(rulesFor(guessed)).toEqual(['owner-guessed']);
  });

  it('flags a wrong owner, and a missing one', () => {
    const wrong = tasks.map((t) =>
      t.text.includes('email') ? { ...t, owner: 'Marcus Bell' } : t,
    );
    expect(rulesFor(wrong)).toEqual(['owner-wrong']);
    const blank = tasks.map((t) =>
      t.text.includes('email') ? { ...t, owner: null } : t,
    );
    expect(rulesFor(blank)).toEqual(['owner-wrong']);
  });

  it('flags points turned into a task', () => {
    const line = 'give Milo 50 points for running study night';
    expect(
      rulesFor([...tasks, { text: line, owner: 'Milo Grant', quote: line }]),
    ).toEqual(['points-as-task']);
  });

  it('flags a quote that is not a line of the notes', () => {
    const reworded = tasks.map((t, index) =>
      index === 0 ? { ...t, quote: 'Priya will email the six members' } : t,
    );
    expect(rulesFor(reworded)).toEqual(['quote-grounding']);
  });

  it('flags a task the notes asked for and the draft left out', () => {
    expect(rulesFor(tasks.slice(1))).toEqual(['task-missing']);
  });

  it('flags a pile of tasks nobody asked for', () => {
    const line = chapter.notes.split('\n')[0];
    const extras = Array.from({ length: 3 }, () => ({
      text: 'Extra',
      owner: null,
      quote: line,
    }));
    expect(rulesFor([...tasks, ...extras])).toEqual(['task-noise']);
  });
});

describe('the synthetic chapter', () => {
  it('says it is fictional, in its name and in every official source', () => {
    expect(SYNTHETIC_CHAPTER_NAME).toContain('fictional');
    for (const doc of SYNTHETIC_CORPUS.filter(
      (d) => d.sourceType === 'chapter_document',
    )) {
      expect(doc.body.toLowerCase()).toContain('fictional');
    }
  });

  it('is chapter-sized: forty people and a few hundred messages', () => {
    expect(ROSTER).toHaveLength(40);
    expect(CHAT_MESSAGES.length).toBeGreaterThanOrEqual(300);
  });

  it('gives every source a unique id', () => {
    const ids = SYNTHETIC_CORPUS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has every message written by someone who can open its channel, with their real answer', () => {
    for (const message of CHAT_MESSAGES) {
      const author = member(message.chat?.authorMemberId ?? '');
      expect([message.id, channelsFor(author)]).toEqual([
        message.id,
        expect.arrayContaining([message.chat?.channelId]),
      ]);
      expect(message.chat?.authorConsented).toBe(author.consent === 'yes');
    }
  });

  it('has members who said no and members who never answered, and their messages', () => {
    const answers = new Set(ROSTER.map((person) => person.consent));
    expect(answers).toEqual(new Set(['yes', 'no', 'unanswered']));
    expect(
      CHAT_MESSAGES.filter((m) => m.chat?.authorConsented === false).length,
    ).toBeGreaterThan(5);
  });

  it('has two members with the same first name, which the task cases rely on', () => {
    expect(ROSTER.filter((p) => p.name.startsWith('Jordan '))).toHaveLength(2);
  });

  describe.each(SYNTHETIC_ASK_CASES.map((c) => [c.id, c] as const))(
    'Ask case %s',
    (_id, evalCase) => {
      const { caller, corpus, toolResults } = evalCase.invocation;
      const open = new Set(caller.channelIds ?? []);
      const readable = [
        ...corpus
          .filter(
            (d) =>
              d.sourceType !== 'chat_message' ||
              (d.chat?.authorConsented && open.has(d.chat.channelId)),
          )
          .map((d) => d.body),
        ...toolResults.map((r) => r.content),
      ].join('\n');

      it('draws every mustMention from what the caller may read', () => {
        for (const needle of evalCase.expect.mustMention ?? []) {
          expect(readable).toContain(needle);
        }
      });

      it('plants its injection where the caller’s retrieval would find it', () => {
        if (!evalCase.injection) return;
        expect(readable).toContain(evalCase.injection.payload);
      });

      it('keeps a fact it forbids out of what the caller may read', () => {
        // An injection's forbidden words are its own payload, planted on
        // purpose. Elsewhere a forbidden string is a fact the filters must
        // keep out, so it must not be readable another way.
        if (evalCase.injection) return;
        for (const needle of evalCase.expect.mustNotMention ?? []) {
          expect(readable.toLowerCase()).not.toContain(needle.toLowerCase());
        }
      });
    },
  );
});
