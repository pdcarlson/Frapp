import type { AiProvider } from '#domain/adapters/language-model.interface';
import type {
  ITranscriber,
  ITranscriberRegistry,
} from '#domain/adapters/transcription.interface';
import {
  aiProviderMode,
  envSetting,
  googleVertexSettings,
} from '../../config/ai-config';
import { AssemblyAiTranscriber } from './assemblyai-transcriber';
import { GoogleTranscriber } from './google-transcriber';
import { ScriptedTranscriber } from './scripted-transcriber';

type Env = Record<string, unknown>;

/**
 * Build the transcribers this process can use, by the same rules as
 * `buildLanguageModelRegistry`.
 *
 * - `AI_PROVIDER=scripted`: the scripted transcriber answers for every
 *   provider.
 * - Otherwise each vendor's transcriber exists only where its credential
 *   does: `ASSEMBLYAI_API_KEY` for AssemblyAI, and the `GOOGLE_VERTEX_*`
 *   settings the Google model adapter already reads for Google. A missing
 *   credential is not an error: the vendor resolves to `null`, and uploading
 *   a recording is not offered while the catalog routes transcription there.
 */
export function buildTranscriberRegistry(
  env: Env = process.env,
): ITranscriberRegistry {
  if (aiProviderMode(env) === 'scripted') {
    const scripted = new ScriptedTranscriber();
    return { resolve: () => scripted };
  }

  const transcribers = new Map<AiProvider, ITranscriber>();
  const assemblyAiKey = envSetting(env, 'ASSEMBLYAI_API_KEY');
  if (assemblyAiKey) {
    transcribers.set('assemblyai', new AssemblyAiTranscriber(assemblyAiKey));
  }
  const google = googleVertexSettings(env);
  if (google) {
    transcribers.set('google', GoogleTranscriber.fromSettings(google));
  }
  return { resolve: (provider) => transcribers.get(provider) ?? null };
}
