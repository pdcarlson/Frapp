import type {
  AiProvider,
  ILanguageModel,
  ILanguageModelRegistry,
} from '#domain/adapters/language-model.interface';
import {
  aiProviderMode,
  envSetting,
  googleVertexSettings,
} from '../../config/ai-config';
import { AnthropicLanguageModel } from './anthropic-language-model';
import { GoogleLanguageModel } from './google-language-model';
import { ScriptedLanguageModel } from './scripted-language-model';
import { SCRIPTED_REPLIES } from './scripted-replies';

type Env = Record<string, unknown>;

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
    const scripted = new ScriptedLanguageModel(
      SCRIPTED_REPLIES,
      scriptedPaceMs(env),
    );
    return { resolve: () => scripted };
  }

  const adapters = new Map<AiProvider, ILanguageModel>();
  const anthropicKey = envSetting(env, 'ANTHROPIC_API_KEY');
  if (anthropicKey) {
    adapters.set('anthropic', AnthropicLanguageModel.fromApiKey(anthropicKey));
  }
  const google = googleVertexSettings(env);
  if (google) {
    adapters.set('google', GoogleLanguageModel.fromSettings(google));
  }
  return { resolve: (provider) => adapters.get(provider) ?? null };
}

/**
 * The longest a paced scripted reply waits before it starts, so a typo
 * cannot hang a walk. A streamed reply then takes a twentieth of the pace
 * for each word.
 */
const SCRIPTED_PACE_MAX_MS = 10_000;

/**
 * `AI_SCRIPTED_PACE_MS`: how long the scripted adapter takes to start each
 * reply. Unset, empty or not a whole number of milliseconds is no wait.
 */
export function scriptedPaceMs(env: Env): number {
  const value = envSetting(env, 'AI_SCRIPTED_PACE_MS');
  if (value === null || !/^\d+$/.test(value)) return 0;
  return Math.min(Number(value), SCRIPTED_PACE_MAX_MS);
}
