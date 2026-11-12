import {
  AI_MODEL_CATALOG,
  aiCatalogEntry,
  aiCostMicroUsd,
  aiTranscriptionCostMicroUsd,
  type AiCatalogEntry,
} from './ai-model-catalog';

describe('AI_MODEL_CATALOG', () => {
  const entries = Object.entries(AI_MODEL_CATALOG) as [
    string,
    AiCatalogEntry,
  ][];

  it('names one provider and model for every task', () => {
    for (const [task, entry] of entries) {
      expect(task).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(entry.model.length).toBeGreaterThan(0);
      if (entry.kind === 'transcription') {
        expect(entry.usdPerAudioHour).toBeGreaterThan(0);
      } else {
        expect(entry.inputUsdPerMillionTokens).toBeGreaterThan(0);
      }
    }
  });

  it('gives every generation task a ceiling on what it may write', () => {
    for (const [, entry] of entries) {
      if (entry.kind === 'embedding' || entry.kind === 'transcription') {
        continue;
      }
      expect(entry.maxOutputTokens).toBeGreaterThan(0);
      expect(entry.outputUsdPerMillionTokens).toBeGreaterThan(0);
    }
  });

  // ADR-28 decision 3: the corpus column is vector(1536). A different width
  // here would fail at the first insert, long after this file was edited.
  it('embeds the corpus at 1,536 dimensions', () => {
    expect(aiCatalogEntry('corpus.embed')).toMatchObject({
      kind: 'embedding',
      dimensions: 1536,
    });
  });

  // No AI over rush, the vault or backwork (the AI build's rules).
  it('has no task for recruitment, the vault or backwork', () => {
    for (const [task] of entries) {
      expect(task).not.toMatch(/rush|recruit|vault|backwork/);
    }
  });
});

function tokenEntry(task: Parameters<typeof aiCatalogEntry>[0]) {
  const entry = aiCatalogEntry(task);
  if (entry.kind === 'transcription') throw new Error('not a token task');
  return entry;
}

describe('aiCostMicroUsd', () => {
  it('prices input and output at the catalog rates', () => {
    const entry = tokenEntry('ask.answer');
    // 1,000 in at $2/M and 500 out at $10/M = $0.002 + $0.005.
    expect(
      aiCostMicroUsd(entry, { inputTokens: 1000, outputTokens: 500 }),
    ).toBe(7000);
  });

  it('charges an embedding for its input only', () => {
    const entry = tokenEntry('corpus.embed');
    expect(
      aiCostMicroUsd(entry, { inputTokens: 1000, outputTokens: 999 }),
    ).toBe(150);
  });

  it('rounds up, so a cap is never under-counted', () => {
    const entry = tokenEntry('corpus.embed');
    expect(aiCostMicroUsd(entry, { inputTokens: 1, outputTokens: 0 })).toBe(1);
  });
});

describe('aiTranscriptionCostMicroUsd', () => {
  const entry = aiCatalogEntry('meetings.transcribe');
  if (entry.kind !== 'transcription') throw new Error('not transcription');

  it('prices a recording by its length at the catalog rate per hour', () => {
    // One hour at $0.23.
    expect(aiTranscriptionCostMicroUsd(entry, 3600)).toBe(230_000);
    expect(aiTranscriptionCostMicroUsd(entry, 7200)).toBe(460_000);
  });

  it('rounds up, and charges nothing for nothing', () => {
    expect(aiTranscriptionCostMicroUsd(entry, 1)).toBe(64);
    expect(aiTranscriptionCostMicroUsd(entry, 0)).toBe(0);
  });
});
