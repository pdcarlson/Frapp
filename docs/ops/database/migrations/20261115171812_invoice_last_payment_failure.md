# 20261115171812_invoice_last_payment_failure.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds three nullable columns to `financial_invoices` that record a member's latest card payment attempt and whether it failed, so the dues screens can end their "confirmation pending" hold on a failure (#3460). The rule is [`spec/behavior/billing.md` § Member payment flow](../../../../spec/behavior/billing.md#member-payment-flow).

## Promotion

- **Purpose**: `last_payment_attempt_at`, `last_payment_failed_at` (both `timestamptz`) and `last_payment_failure_reason` (`text`), all null by default. The pay endpoint stamps the first and clears the other two on each new attempt; the `payment_intent.payment_failed` webhook writes the other two. Existing rows stay null, which reads as "no failed attempt".
- **Checks**: After `db push`, `select count(*) from information_schema.columns where table_name = 'financial_invoices' and column_name like 'last_payment_%';` returns `3`.
- **Promoter notes**: Ship it before, or with, the API from the same PR; a deploy applies migrations first. The older API ignores the columns (it reads `select *` and writes neither). During a rolling deploy an old instance can stamp a new attempt without clearing an earlier failure; clients count a failure only when it is newer than their own submit or capture, so that one reads as no failure. The newer API against an unmigrated database fails the pay endpoint's stamp (500) and the failure webhook's write (Stripe retries it). `add column if not exists` with no default is a catalog-only change under a brief `ACCESS EXCLUSIVE` lock and is idempotent. No data written, nothing by hand.

## Rollback

Revert the API forward and keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The reverted API never writes the columns, but shipped phone builds and cached web pages still read `last_payment_failed_at`, and nothing clears a failure recorded before the revert. So once the code revert has shipped, null the failure pair in the same step, or a member whose earlier attempt failed could see "didn't go through" beside a later payment that went through:

```sql
update public.financial_invoices
  set last_payment_failed_at = null, last_payment_failure_reason = null
  where last_payment_failed_at is not null;
```

Those clients then go back to holding "confirmation pending" on a failed payment until the member leaves. To remove the columns too, in a later forward migration:

```sql
alter table public.financial_invoices
  drop column if exists last_payment_failure_reason,
  drop column if exists last_payment_failed_at,
  drop column if exists last_payment_attempt_at;
```
