### ADR-18: Agent operating docs — recurring rules vs one-off records; spec vs code (2026-08-19)

**Decision:** Split agent operating knowledge by half-life.

- **`AGENTS.md`** holds only rules that are (1) recurring, (2) still true, and (3) something an agent would not derive by reading the code. Target: short enough to load every session (~200 lines).
- **ADRs** in this folder record one-off incidents and decisions — what was decided, and the reasoning that made it the decision. They are ordinary documentation, governed by [`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md) like every other doc: when an ADR says something that is no longer true, correct it in place and date the correction. **Corrected 2026-09-05** (this bullet, edited in place under the rule it now states): it previously read "ADRs in this file are the immutable, append-only log of one-off incidents and decisions. Never edit an ADR in place; supersede it with an amendment or a new ADR." That append-only rule is revoked — it was keeping known-wrong sentences in the log, including dead command names an agent would try to run. Amending or superseding is still the right shape when the *decision* itself changes; it is no longer required to fix a *wrong sentence*. Two things the ordinary standard still requires here: evidence (dated records, run links, run ids, the command behind a figure) is not discarded when a claim around it is corrected, and ADR numbers and headings are cited across CI workflows, scripts and tests with nothing validating them, so renaming one is a rename like any other: sweep for what points at it first. Incident narration (dated outages, specific PR numbers, permission-tool archaeology) lives here, not in `AGENTS.md`.
- **Skills** under `.claude/skills/` hold task playbooks (including filing follow-up issues). **Commands** under `.claude/commands/` hold user-invocable procedures (`/next` stays a command).
- **Spec vs code:** `spec/` is the source of truth for *intended* behavior; code is the source of truth for *current* behavior. Disagreement is a tracked bug to file, not silent agent discretion.

**Rationale:** `AGENTS.md` had grown into a mix of durable rules, one-off incident write-ups, and a 60-line issue-filing playbook. Agents either drowned in archaeology or treated a stale spec sentence as current behavior (or the reverse). The three-way split matches how the knowledge is actually used: always-on constraints, historical decisions, and on-demand playbooks.

**Consequences:**

- A new "we hit X, don't do Y" story is an ADR (or an amendment), not a paragraph in `AGENTS.md`, unless it meets the three-part graduation test.
- `README.md`, `spec/behavior/README.md`, and `spec/README.md` use the same spec-vs-code formulation. Do not reintroduce "the spec is the single source of truth" or "code is ground truth for behavior; docs are ground truth for intent" as competing slogans.
- Filing follow-up work lives in `.claude/skills/file-follow-up/SKILL.md`. Routine ownership boilerplate lives once in [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).

**Trigger to revisit:** `AGENTS.md` grows past ~200 lines again, or a rule in it is no longer true.
