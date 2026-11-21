# 20261113203728_ai_ask_traces_and_feedback.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the three tables behind the trace of every Ask turn and the member's thumbs on an answer (#4902): `ai_ask_traces`, `ai_ask_trace_steps` and `ai_ask_feedback`.

## Promotion

- **Purpose**: `ai_ask_traces` holds one row per Ask turn (who asked, the door, prompt version, model, how it ended, and counts), `ai_ask_trace_steps` one row per model round and tool call in it (the tool's name, sizes, timings, tokens, cost), and `ai_ask_feedback` the asker's thumbs up or down with one of four reasons. None has a column that can hold a question, an answer, a tool's arguments or its result: every text column is a code and a check holds it to that. A trace is deleted after at most 90 days, and with the asker's membership, their account or the chapter. All three have RLS on and no policies: the API is the only reader and writer.
- **Checks**:
  - `select count(*) from ai_ask_traces;`, `select count(*) from ai_ask_trace_steps;` and `select count(*) from ai_ask_feedback;` all run and return 0.
  - `select relrowsecurity from pg_class where relname in ('ai_ask_traces', 'ai_ask_trace_steps', 'ai_ask_feedback');` returns `t` three times.
  - `select count(*) from pg_policies where tablename like 'ai_ask_%';` returns 0.
- **Promoter notes**: additive, writes no data, and safe to apply before the API that uses it. Nothing by hand.

## Rollback

Worth it only if the tables themselves cause a fault: nothing reads them to answer a member, and a failed trace write never costs anyone their answer. Revert the API first, then run a forward migration. Dropping the tables loses the traces and thumbs kept so far, which nothing else holds.

```sql
drop table if exists public.ai_ask_feedback;
drop table if exists public.ai_ask_trace_steps;
drop table if exists public.ai_ask_traces;
```
