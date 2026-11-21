import { randomBytes } from 'node:crypto';
import {
  aiStoredTextKeyRing,
  askDiagnosticsChapterId,
  validateAiStoredTextEnv,
} from './ai-stored-text-config';

const KEY = `k1:${randomBytes(32).toString('base64')}`;
const CHAPTER = '11111111-1111-4111-8111-111111111111';

describe('stored AI text settings', () => {
  it('has no key ring and names no chapter when nothing is set', () => {
    expect(aiStoredTextKeyRing({})).toBeNull();
    expect(askDiagnosticsChapterId({})).toBeNull();
    expect(validateAiStoredTextEnv({})).toEqual([]);
  });

  it('reads the key and the chapter', () => {
    const env = {
      AI_STORED_TEXT_KEY: KEY,
      AI_DIAGNOSTICS_CHAPTER_ID: CHAPTER.toUpperCase(),
    };
    expect(aiStoredTextKeyRing(env)).not.toBeNull();
    expect(askDiagnosticsChapterId(env)).toBe(CHAPTER);
    expect(validateAiStoredTextEnv(env)).toEqual([]);
  });

  it('refuses to boot on a malformed key, without echoing it', () => {
    const problems = validateAiStoredTextEnv({
      AI_STORED_TEXT_KEY: 'k1:not-a-real-key',
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain('not-a-real-key');
  });

  it('refuses a chapter that is not an id, and a chapter with no key to seal with', () => {
    expect(
      validateAiStoredTextEnv({
        AI_STORED_TEXT_KEY: KEY,
        AI_DIAGNOSTICS_CHAPTER_ID: 'phi-gamma-delta',
      }),
    ).toEqual(['AI_DIAGNOSTICS_CHAPTER_ID must be a chapter id (a UUID).']);
    expect(
      validateAiStoredTextEnv({ AI_DIAGNOSTICS_CHAPTER_ID: CHAPTER }),
    ).toEqual([
      'AI_DIAGNOSTICS_CHAPTER_ID needs AI_STORED_TEXT_KEY: stored AI text is always encrypted.',
    ]);
    expect(
      askDiagnosticsChapterId({ AI_DIAGNOSTICS_CHAPTER_ID: 'nope' }),
    ).toBeNull();
  });
});
