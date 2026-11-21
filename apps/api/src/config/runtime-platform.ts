type Env = Record<string, unknown>;

/**
 * Whether this process runs on Cloud Run (#5228), which sets `K_SERVICE` on
 * every instance. Three things change there: Vertex AI can sign in as the
 * service's own identity (`ai-config.ts`), Google Drive can act as its
 * `frapp-docs` account with no key file (`google-drive-config.ts`, #5434),
 * and logs go out as one JSON record per line for Cloud Logging
 * (`request-context-logger.ts`).
 */
export function runsOnCloudRun(env: Env = process.env): boolean {
  const value = env.K_SERVICE;
  return typeof value === 'string' && value.trim().length > 0;
}
