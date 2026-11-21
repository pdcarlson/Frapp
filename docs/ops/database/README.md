# Database runbooks

How a schema change reaches the hosted databases, the checks that guard the
order it lands in, and the record of every promotion. **Routers link; leaves
assert.** Cite a leaf and a heading anchor, never `§N`.

| Leaf | Read it when |
| ---- | ------------ |
| [`promotion.md`](promotion.md) | You are shipping a migration: how it reaches each environment, the preflight checklist, verifying a staging apply, and dispatching `Deploy production` |
| [`drift-and-ordering.md`](drift-and-ordering.md) | `migration-order` or `migration-drift` is red, `db push` refuses, or a hosted ledger needs a hand repair (`--include-all`, a foreign row) |
| [`migrations/`](migrations/README.md) | You are writing the ledger page your migration owes (its promotion entry and rollback recipe), or need a migration's checks and promoter notes from 2026-11-12 on |
| [`promotion-log.md`](promotion-log.md) | You need what an earlier promotion did and how it was checked (migrations before 2026-11-12) |

Undoing a migration and recovering from a backup are
[`../db-rollback-playbook.md`](../db-rollback-playbook.md).
