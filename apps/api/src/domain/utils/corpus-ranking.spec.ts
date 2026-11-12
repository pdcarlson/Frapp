import { AI_MODEL_CATALOG } from '../constants/ai-model-catalog';
import { AI_RUN_DEDUPE_KEY } from './ai-runs';
import {
  CORPUS_PIPELINE_VERSION,
  corpusFingerprint,
  reciprocalRankFusion,
  recencyWeight,
} from './corpus-ranking';

describe('reciprocalRankFusion', () => {
  it('scores a passage both lists found above one only one list found', () => {
    const both = reciprocalRankFusion([3, 3]);
    const denseOnly = reciprocalRankFusion([1, null]);
    const sparseOnly = reciprocalRankFusion([null, 1]);
    expect(both).toBeGreaterThan(denseOnly);
    expect(denseOnly).toBe(sparseOnly);
    expect(denseOnly).toBeCloseTo(1 / 61, 10);
  });

  it('scores a better rank higher, and nothing as zero', () => {
    expect(reciprocalRankFusion([1, null])).toBeGreaterThan(
      reciprocalRankFusion([2, null]),
    );
    expect(reciprocalRankFusion([null, null])).toBe(0);
  });
});

describe('recencyWeight', () => {
  it('is 1 for a new source, 0.75 at the half-life, and never below a half', () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(-5)).toBe(1);
    expect(recencyWeight(180)).toBeCloseTo(0.75, 10);
    expect(recencyWeight(100_000)).toBeGreaterThanOrEqual(0.5);
    expect(recencyWeight(Number.NaN)).toBe(1);
  });
});

describe('corpusFingerprint', () => {
  it('names the model, the width and the pipeline', () => {
    expect(corpusFingerprint('gemini-embedding-001', 1536)).toBe(
      `gemini-embedding-001.1536.p${CORPUS_PIPELINE_VERSION}`,
    );
  });

  it('fits inside an AI run dedupe key for every embedding model in the catalog', () => {
    for (const entry of Object.values(AI_MODEL_CATALOG)) {
      if (entry.kind !== 'embedding') continue;
      const key = `source:00000000-0000-4000-8000-000000000720:12:${corpusFingerprint(entry.model, entry.dimensions)}`;
      expect(key).toMatch(AI_RUN_DEDUPE_KEY);
    }
  });
});

describe('the two embedding tasks', () => {
  it('use one model and one width, or a question could not be compared with a passage', () => {
    const index = AI_MODEL_CATALOG['corpus.embed'];
    const query = AI_MODEL_CATALOG['ask.embed-query'];
    expect([query.provider, query.model, query.dimensions]).toEqual([
      index.provider,
      index.model,
      index.dimensions,
    ]);
    // The database column is this wide (`20261112165050_ai_corpus.sql`).
    expect(index.dimensions).toBe(1536);
  });

  it('sit in different families: indexing behind the chapter, a question behind the asker', () => {
    expect(AI_MODEL_CATALOG['corpus.embed'].family).toBe('corpus');
    expect(AI_MODEL_CATALOG['ask.embed-query'].family).toBe('ask');
  });
});
