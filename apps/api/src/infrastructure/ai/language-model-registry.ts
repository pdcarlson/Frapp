import type {
  AiProvider,
  ILanguageModel,
  ILanguageModelRegistry,
} from '#domain/adapters/language-model.interface';
import { aiProviderMode, googleVertexSettings } from '../../config/ai-config';
import { AnthropicLanguageModel } from './anthropic-language-model';
import { GoogleLanguageModel } from './google-language-model';
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
 * variables. Google needs a project and a service account's key together
 * (`googleVertexSettings`); boot refuses one without the other.
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
  const google = googleVertexSettings(env);
  if (google) {
    adapters.set('google', GoogleLanguageModel.fromSettings(google));
  }
  return { resolve: (provider) => adapters.get(provider) ?? null };
}
