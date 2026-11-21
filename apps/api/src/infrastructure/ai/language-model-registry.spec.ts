import { AnthropicLanguageModel } from './anthropic-language-model';
import { GoogleLanguageModel } from './google-language-model';
import {
  buildLanguageModelRegistry,
  scriptedPaceMs,
} from './language-model-registry';
import { ScriptedLanguageModel } from './scripted-language-model';

describe('buildLanguageModelRegistry', () => {
  it('has no adapter at all where nothing is configured', () => {
    const registry = buildLanguageModelRegistry({});
    expect(registry.resolve('anthropic')).toBeNull();
    expect(registry.resolve('google')).toBeNull();
    expect(registry.resolve('scripted')).toBeNull();
  });

  it('treats a blank credential as missing', () => {
    const registry = buildLanguageModelRegistry({ ANTHROPIC_API_KEY: '   ' });
    expect(registry.resolve('anthropic')).toBeNull();
  });

  it('builds the Anthropic adapter where its key is set, and only that one', () => {
    const registry = buildLanguageModelRegistry({
      // Not a real key, and nothing here makes a request.
      ANTHROPIC_API_KEY: 'unit-test-value',
    });
    expect(registry.resolve('anthropic')).toBeInstanceOf(
      AnthropicLanguageModel,
    );
    expect(registry.resolve('google')).toBeNull();
  });

  it('answers for every provider with the scripted adapter in scripted mode', () => {
    const registry = buildLanguageModelRegistry({
      AI_PROVIDER: 'scripted',
      ANTHROPIC_API_KEY: 'unit-test-value',
    });
    expect(registry.resolve('anthropic')).toBeInstanceOf(ScriptedLanguageModel);
    expect(registry.resolve('google')).toBe(registry.resolve('anthropic'));
  });

  it('paces the scripted adapter only by a whole number of milliseconds, capped', () => {
    expect(scriptedPaceMs({})).toBe(0);
    expect(scriptedPaceMs({ AI_SCRIPTED_PACE_MS: ' ' })).toBe(0);
    expect(scriptedPaceMs({ AI_SCRIPTED_PACE_MS: '1500' })).toBe(1500);
    expect(scriptedPaceMs({ AI_SCRIPTED_PACE_MS: '1.5s' })).toBe(0);
    expect(scriptedPaceMs({ AI_SCRIPTED_PACE_MS: '-20' })).toBe(0);
    expect(scriptedPaceMs({ AI_SCRIPTED_PACE_MS: '999999' })).toBe(10_000);
  });

  it('builds the Google adapter only with a project and a service account key', () => {
    const key = JSON.stringify({
      type: 'service_account',
      client_email: 'unit-test@example.invalid',
      private_key: 'unit-test-value',
    });
    expect(
      buildLanguageModelRegistry({ GOOGLE_VERTEX_PROJECT: 'p' }).resolve(
        'google',
      ),
    ).toBeNull();
    // An AI Studio key is never a way in (ADR-28 decision 3).
    expect(
      buildLanguageModelRegistry({ GEMINI_API_KEY: 'unit-test-value' }).resolve(
        'google',
      ),
    ).toBeNull();
    const registry = buildLanguageModelRegistry({
      GOOGLE_VERTEX_PROJECT: 'frapp-ai-staging',
      GOOGLE_VERTEX_CREDENTIALS_JSON: key,
    });
    expect(registry.resolve('google')).toBeInstanceOf(GoogleLanguageModel);
    expect(registry.resolve('anthropic')).toBeNull();
  });
});
