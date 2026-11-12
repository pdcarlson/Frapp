import { isProductionSupabaseUrl } from '@repo/validation';
import { isAiEnabled } from '#domain/utils/ai-enabled';

type Env = Record<string, unknown>;

// The switch itself is domain code (`#domain/utils/ai-enabled`), so every
// layer reads the same definition. Re-exported for this file's callers.
export { isAiEnabled };

/**
 * Which adapters serve the catalog's tasks.
 *
 * - `live` (the default): each provider's own adapter, where its credential
 *   is set. A task whose provider has none is not available.
 * - `scripted`: every task is answered by the scripted adapter, with canned
 *   replies and no network. For local development, tests and evals.
 */
export type AiProviderMode = 'live' | 'scripted';

export function aiProviderMode(env: Env = process.env): AiProviderMode {
  return env.AI_PROVIDER === 'scripted' ? 'scripted' : 'live';
}

/**
 * Where the Google adapter sends its calls, or `null` when Google is not
 * configured here. All three are names on Google Cloud's paid platform
 * (Vertex AI): there is no API-key path, because AI Studio keys and the
 * free tier fall under terms that allow training on what they receive
 * (ADR-28 decision 3).
 *
 * - `GOOGLE_VERTEX_PROJECT`: the project id (`frapp-ai-staging` or
 *   `frapp-ai-prod`, #4316).
 * - `GOOGLE_VERTEX_CREDENTIALS_JSON`: that project's service account key
 *   file, as JSON. Needed together with the project; boot refuses one
 *   without the other.
 * - `GOOGLE_VERTEX_LOCATION`: optional, `global` when unset.
 */
export interface GoogleVertexEnvSettings {
  project: string;
  location: string;
  /** A service account's key file, parsed. Never an API key. */
  credentials: Record<string, unknown>;
}

export const GOOGLE_VERTEX_DEFAULT_LOCATION = 'global';

/** A variable's trimmed value, or null when it is unset or blank. */
export function envSetting(env: Env, name: string): string | null {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseServiceAccount(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === 'service_account' &&
      typeof (parsed as { client_email?: unknown }).client_email === 'string' &&
      typeof (parsed as { private_key?: unknown }).private_key === 'string'
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Reported by validateAiEnv; never echoed, since it is a secret.
  }
  return null;
}

export function googleVertexSettings(
  env: Env = process.env,
): GoogleVertexEnvSettings | null {
  const project = envSetting(env, 'GOOGLE_VERTEX_PROJECT');
  const json = envSetting(env, 'GOOGLE_VERTEX_CREDENTIALS_JSON');
  if (!project || !json) return null;
  const credentials = parseServiceAccount(json);
  if (!credentials) return null;
  return {
    project,
    location:
      envSetting(env, 'GOOGLE_VERTEX_LOCATION') ??
      GOOGLE_VERTEX_DEFAULT_LOCATION,
    credentials,
  };
}

/**
 * Boot-time checks, called from `validateEnv`. A typo in a switch must not
 * read as "off" (or, worse, as "live") without anyone noticing.
 */
export function validateAiEnv(env: Env): string[] {
  const problems: string[] = [];
  const enabled = env.AI_ENABLED;
  if (
    enabled !== undefined &&
    enabled !== '' &&
    enabled !== 'true' &&
    enabled !== 'false'
  ) {
    problems.push('AI_ENABLED must be "true" or "false" when set.');
  }
  const provider = env.AI_PROVIDER;
  if (
    provider !== undefined &&
    provider !== '' &&
    provider !== 'live' &&
    provider !== 'scripted'
  ) {
    problems.push('AI_PROVIDER must be "live" or "scripted" when set.');
  }
  const vertexProject = envSetting(env, 'GOOGLE_VERTEX_PROJECT');
  const vertexJson = envSetting(env, 'GOOGLE_VERTEX_CREDENTIALS_JSON');
  if (Boolean(vertexProject) !== Boolean(vertexJson)) {
    problems.push(
      'GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_CREDENTIALS_JSON are set together or not at all.',
    );
  } else if (vertexJson && !parseServiceAccount(vertexJson)) {
    problems.push(
      'GOOGLE_VERTEX_CREDENTIALS_JSON must be a service account key file (JSON with type "service_account").',
    );
  }
  // Canned replies must never reach a real chapter as if a model wrote them.
  if (
    provider === 'scripted' &&
    typeof env.SUPABASE_URL === 'string' &&
    isProductionSupabaseUrl(env.SUPABASE_URL)
  ) {
    problems.push(
      'AI_PROVIDER=scripted is refused against the production database: the scripted adapter returns canned text.',
    );
  }
  return problems;
}
