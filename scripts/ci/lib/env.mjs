// The one `requireEnv`.
//
// Fourteen byte-identical copies lived under `scripts/ci/` before this, and a
// fifteenth in `check-migration-drift-gate.mjs` had already drifted — it emitted
// a GitHub Actions `::error::` annotation and pointed at the secrets runbook,
// which the other thirteen did not. That drift is the argument for one
// definition: the better of the two behaviours was written once and never
// reached its siblings.
//
// This keeps the richer behaviour for everyone. `::error::` is emitted only
// under Actions, where it renders as an annotation on the job; locally it would
// be noise, so the plain `Error:` prefix the thirteen used is kept there.

/**
 * The value of `name`, or exit 1 having said which variable is missing.
 *
 * `hint` appends a pointer to whatever the caller knows about provisioning —
 * `check-migration-drift-gate.mjs` used it for the secrets runbook.
 *
 * `env`, `log` and `exit` are injectable so the behaviour is testable without a
 * subprocess; the defaults are the real process.
 */
export function requireEnv(
  name,
  {
    hint,
    env = process.env,
    log = console.error,
    exit = (code) => process.exit(code),
  } = {},
) {
  const value = env[name];
  if (value) return value;

  const message = `${name} environment variable is required.${hint ? ` ${hint}` : ""}`;
  log(env.GITHUB_ACTIONS ? `::error::${message}` : `Error: ${message}`);
  exit(1);
  // Unreachable in production; reached in tests that inject a non-exiting
  // `exit`, where returning undefined is the honest answer.
  return undefined;
}

/** Where the secrets live, for the `hint` above. */
export const SECRETS_RUNBOOK = "See docs/internal/environment/SECRETS_MANAGEMENT.md.";
