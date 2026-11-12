import {
  LanguageModelError,
  type CitedLanguageModelRequest,
  type LanguageModelStreamEvent,
  type StructuredLanguageModelRequest,
} from '#domain/adapters/language-model.interface';
import { ScriptedLanguageModel } from './scripted-language-model';

const cited: CitedLanguageModelRequest = {
  kind: 'cited',
  task: 'ask.answer',
  model: 'any',
  messages: [{ role: 'user', content: 'When is formal?' }],
  maxOutputTokens: 100,
  sources: [{ id: 'minutes', title: 'Minutes', text: 'Formal is April 12.' }],
};

const structured: StructuredLanguageModelRequest = {
  kind: 'structured',
  task: 'minutes.draft',
  model: 'any',
  messages: [{ role: 'user', content: 'notes' }],
  maxOutputTokens: 100,
  schema: { type: 'object' },
};

describe('ScriptedLanguageModel', () => {
  it('answers a task from its script, which may read the request', async () => {
    const model = new ScriptedLanguageModel({
      'ask.answer': (request) => ({
        text: 'Formal is April 12.',
        citations:
          request.kind === 'cited'
            ? [
                {
                  sourceId: request.sources[0].id,
                  quote: 'Formal is April 12.',
                },
              ]
            : [],
      }),
    });

    await expect(model.generate(cited)).resolves.toEqual({
      outcome: 'completed',
      text: 'Formal is April 12.',
      citations: [{ sourceId: 'minutes', quote: 'Formal is April 12.' }],
      truncated: false,
      usage: { inputTokens: 9, outputTokens: 5, cachedInputTokens: 0 },
    });
  });

  it('returns the scripted object for a structured task', async () => {
    const model = new ScriptedLanguageModel({
      'minutes.draft': () => ({
        text: '{"title":"x"}',
        object: { title: 'x' },
      }),
    });
    const result = await model.generate(structured);
    expect(result).toMatchObject({
      outcome: 'completed',
      object: { title: 'x' },
    });
  });

  it('plays a refusal and a failure', async () => {
    const refusing = new ScriptedLanguageModel({
      'ask.answer': () => ({ refuse: { category: 'policy' } }),
    });
    await expect(refusing.generate(cited)).resolves.toMatchObject({
      outcome: 'refused',
      category: 'policy',
    });

    const failing = new ScriptedLanguageModel({
      'ask.answer': () => ({ fail: 'rate_limited' }),
    });
    await expect(failing.generate(cited)).rejects.toMatchObject({
      kind: 'rate_limited',
      provider: 'scripted',
      retryable: true,
    });
  });

  it('answers an unscripted cited task with a marker and no citations', async () => {
    const result = await new ScriptedLanguageModel().generate(cited);
    expect(result).toMatchObject({
      outcome: 'completed',
      text: 'Scripted reply for ask.answer.',
      citations: [],
    });
  });

  it('fails an unscripted structured task, since no marker fits a schema', async () => {
    await expect(
      new ScriptedLanguageModel().generate(structured),
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('never lets a broken script throw its own error through the port', async () => {
    const model = new ScriptedLanguageModel({
      'ask.answer': (request) => {
        throw new Error(`boom: ${request.messages[0].content}`);
      },
    });
    const error = await model.generate(cited).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LanguageModelError);
    expect((error as Error).message).not.toContain('formal');
  });

  it('streams the text in pieces, then the whole result once', async () => {
    const model = new ScriptedLanguageModel({
      'ask.answer': () => ({ text: 'Formal is April 12.' }),
    });
    const events: LanguageModelStreamEvent[] = [];
    for await (const event of model.stream(cited)) events.push(event);

    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : []));
    expect(text.length).toBeGreaterThan(1);
    expect(text.join('')).toBe('Formal is April 12.');
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      result: { text: 'Formal is April 12.' },
    });
  });

  it('embeds each text as a repeatable unit vector of the asked width', async () => {
    const model = new ScriptedLanguageModel();
    const request = {
      task: 'corpus.embed',
      model: 'any',
      texts: ['bylaws', 'minutes'],
      dimensions: 1536,
    };
    const first = await model.embed(request);
    const second = await model.embed(request);

    expect(first.vectors).toHaveLength(2);
    expect(first.vectors[0]).toHaveLength(1536);
    expect(first.vectors).toEqual(second.vectors);
    expect(first.vectors[0]).not.toEqual(first.vectors[1]);
    expect(Math.hypot(...first.vectors[0])).toBeCloseTo(1, 6);
  });
});
