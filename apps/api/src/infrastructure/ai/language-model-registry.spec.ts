import { AnthropicLanguageModel } from './anthropic-language-model';
import { buildLanguageModelRegistry } from './language-model-registry';
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
});
