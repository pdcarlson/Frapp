// Where the ops docs that scripts name live, as repo-relative paths.
//
// Gates, alert bodies and migration tooling point operators at these docs, and
// the tests read them from disk: `ops-docs.test.mjs` fails on any path git does
// not track. Each path is written here once, so moving a doc is one edit here
// plus the links a grep finds. #1598's stage 7 moved these docs out of
// docs/internal/ops/ and found them copied into a dozen scripts and nine tests.

/**
 * The dated log of what each hosted database was promoted to, and the ledger
 * `check:migration-safety` reads. Point a reader at procedure through the two
 * constants below, never through this one.
 */
export const PROMOTION_LOG = "docs/ops/database/promotion-log.md";

/** How a migration reaches staging and production, and the checks around it. */
export const PROMOTION_RUNBOOK = "docs/ops/database/promotion.md";

/**
 * What `migration-order` and `migration-drift` judge, and the two recoveries a
 * red one can need: `--include-all`, and reconciling a foreign migration row.
 */
export const DRIFT_AND_ORDERING = "docs/ops/database/drift-and-ordering.md";

/** Per-migration rollback recipes, and backup recovery. */
export const ROLLBACK_PLAYBOOK = "docs/ops/db-rollback-playbook.md";

/** The alert roster, and the escalation rule every alert body links to. */
export const ALERT_ROUTING = "docs/ops/alert-routing.md";
