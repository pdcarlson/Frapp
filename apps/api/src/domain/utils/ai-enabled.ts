/**
 * The server switch for every AI feature (ADR-28, the AI build's rule that
 * everything ships off). The one definition: the gateway, the run queue, the
 * route guard and the permissions catalog all read it here.
 *
 * On is exactly `AI_ENABLED=true`. Unset, empty or anything else is off, and
 * a value that is neither `true` nor `false` fails boot (`validateAiEnv`), so
 * a typo cannot read as off without anyone noticing. Off means the API
 * behaves as it did before any AI code existed: every AI route answers 404
 * `ai.not_available`, the gateway makes no call and asks no seam, the run
 * worker never queries its table, and no AI entry point is offered to a
 * client.
 *
 * It is the outermost of the gates, not the only one. With it on, a call
 * still needs the provider's credential, the chapter's switch and the
 * member's yes (`spec/behavior/ai.md` § Consent), and room under the caps.
 *
 * Read on each call, not cached, so a test (or a restart with a new value)
 * changes it without rebuilding anything.
 */
export function isAiEnabled(
  env: Record<string, unknown> = process.env,
): boolean {
  return env.AI_ENABLED === 'true';
}
