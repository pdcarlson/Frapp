export type Env = Record<string, unknown>;

/**
 * An optional environment variable, or `undefined` when it is unset: missing,
 * not a string, or only whitespace. One definition, so every optional
 * variable's boot check and its reader agree on what "unset" means.
 */
export function envValue(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
