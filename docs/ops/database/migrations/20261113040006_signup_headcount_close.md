# 20261113040006_signup_headcount_close.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Sign-up headcounts and closing (#3926, step 2): the claim function takes a note on a headcount answer and refuses claims on a closed card.

## Promotion

- **Purpose**: Replaces `claim_signup_slots(uuid, uuid, text[])` with `claim_signup_slots(uuid, uuid, text[], text default null)`. The new argument is the note a member may add to a headcount answer, stored as the claim's `payload.note`. The function now refuses every claim on a card that is closed (`signup_closed`): `payload.closed_at` is set, or `payload.closes_at` has passed. Both are read under the card's row lock. Still security definer, with EXECUTE for `service_role` only. Changes no table and writes no row on apply.
- **Checks**: After `db push`, `select count(*) from pg_proc where proname = 'claim_signup_slots';` returns `1`. `select has_function_privilege('authenticated', 'public.claim_signup_slots(uuid, uuid, text[], text)', 'execute');` returns `false`, and the same check for `service_role` returns `true`.
- **Promoter notes**: Apply it after `20261112250000_signup_card_claims.sql`, whose function it replaces. The step 1 API's three-argument call still resolves, because `p_note` has a default, so the migration can land before or with the API. Hosted projects are not applied from a cloud-agent session.

## Rollback

Replaces one function and changes no table. **Revert the API forward, and keep the migration file** ([playbook § 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The step 1 API calls the function with three arguments, which this version still takes.

Leaving the function in place is the safe rollback: a closed card keeps refusing claims, so nobody's name moves on a card its creator closed. Two things change while the API is on step 1:

- A tap on a closed or past-end card is refused as a **500**, not a 400, because the step 1 API doesn't know the function's `signup_closed` refusal. Expect those taps in Sentry, and expect the older clients to draw such a card as open.
- A step 1 claim sends no note, so a member who changes a headcount answer then loses the note on it.

Claims that carry a `note` stay ordinary action rows; older clients ignore the field. To restore the step 1 behaviour in a later forward migration, recreate the step 1 function body from `20261112250000_signup_card_claims.sql` and drop this one:

```sql
drop function if exists public.claim_signup_slots(uuid, uuid, text[], text);
```
