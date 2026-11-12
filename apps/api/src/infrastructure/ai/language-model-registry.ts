import type {
  AiProvider,
  ILanguageModel,
  ILanguageModelRegistry,
} from '#domain/adapters/language-model.interface';
import { aiProviderMode } from '../../config/ai-config';
import { AnthropicLanguageModel } from './anthropic-language-model';
import { ScriptedLanguageModel } from './scripted-language-model';
import { SCRIPTED_REPLIES } from './scripted-replies';

type Env = Record<string, unknown>;

function credential(env: Env, name: string): string | null {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Build the adapters this process can use.
 *
 * - `AI_PROVIDER=scripted`: the scripted adapter answers for every provider.
 * - Otherwise each provider's adapter exists only where its credential does.
 *   A missing credential is not an error: the provider resolves to `null`
 *   and the gateway answers "not available" for the tasks routed to it.
 *
 * A new provider is one more entry here, behind its own environment
 * variable (the Google adapter comes with #4311).
 */
export function buildLanguageModelRegistry(
  env: Env = process.env,
): ILanguageModelRegistry {
  if (aiProviderMode(env) === 'scripted') {
    const scripted = new ScriptedLanguageModel(SCRIPTED_REPLIES);
    return { resolve: () => scripted };
  }

  const adapters = new Map<AiProvider, ILanguageModel>();
  const anthropicKey = credential(env, 'ANTHROPIC_API_KEY');
  if (anthropicKey) {
    adapters.set('anthropic', AnthropicLanguageModel.fromApiKey(anthropicKey));
  }
  return { resolve: (provider) => adapters.get(provider) ?? null };
}
