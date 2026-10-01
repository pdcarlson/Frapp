// Where the ops docs that scripts name live, as repo-relative paths.
//
// Gates, alert bodies and migration tooling point operators at these docs, and
// the tests read them from disk. Each path is written here once, so moving a doc
// is one edit here plus the links a grep finds. #1598's stage 7 moved these
// docs out of docs/internal/ops/ and found them copied into a dozen scripts and
// nine tests.

/** The dated log of what each hosted database was promoted to. */
export const PROMOTION_LOG = "docs/ops/db-promotion-runbook.md";

/** Per-migration rollback recipes, and backup recovery. */
export const ROLLBACK_PLAYBOOK = "docs/ops/db-rollback-playbook.md";

/** The alert roster, and the escalation rule every alert body links to. */
export const ALERT_ROUTING = "docs/ops/alert-routing.md";
