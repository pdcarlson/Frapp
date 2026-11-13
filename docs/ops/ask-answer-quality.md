# Ask answer quality: the trace of each turn and the thumbs on it

How the Frapp team tells whether Ask's answers are good, from records that hold no text (#4902). The rules are in [`spec/behavior/ai.md` § Stored AI text](../../spec/behavior/ai.md#stored-ai-text) and [§ Feedback on an answer](../../spec/behavior/ai.md#feedback-on-an-answer); the table shapes are the migration's (`20261113203728_ai_ask_traces_and_feedback.sql`). When a member chooses to send the words of an answer, that is a report, and reading it is on [`ai-stored-text.md`](ai-stored-text.md).

> **Not running yet (2026-11-13).** Nothing calls `AskTraceService.record` until the agent loop does (#4899). Until then no trace is written, so a thumbs or a tap on any answer is refused as not found and the tables stay empty.

## What is kept

| Table | One row per | Holds |
| --- | --- | --- |
| `ai_ask_traces` | Ask turn | Who asked (ids), the door, prompt version, model, effort, how it ended, whether it followed an earlier turn or came within a minute of the last question, and totals: rounds, tool calls and failures, tokens, cost, duration, sources, citations kept and dropped, messages left out, cards proposed |
| `ai_ask_trace_steps` | Model round or tool call in a turn | The tool's name, the size of its arguments and its result, how long it took, how it ended; a round's tokens and cost |
| `ai_ask_feedback` | Rated answer | The asker's thumbs (`up`, `down`) and, on a down, one reason (`wrong`, `missed`, `too_long`, `other`) |

No column can hold a question, an answer, a tool's arguments or its result: every text column is a code, checked in the API (`cleanAskTrace`) and again by a constraint. A trace is written by `AskTraceService.record`, which the Ask loop calls once when a turn ends.

A trace, with its steps and thumbs, is deleted:

- 90 days after the turn (a sweep runs every hour, whether or not AI is still on);
- when the asker leaves the chapter or deletes their account;
- when the asker answers No on the AI sheet;
- when the chapter is deleted.

No route serves a trace. The only thing a client can do is set, change or take back the asker's own thumbs.

The usage ledger (`ai_usage_events`) still holds every provider call and is what billing reads. It cannot say which calls made up one turn, which is why a turn's rounds are also on its trace.

## Reading it

Run these in the Supabase SQL editor. They read ids and counts only, so the results can go in an issue; a chapter's or a member's id still should not.

Answers a day, with how they ended and the thumbs on them:

```sql
select date_trunc('day', t.started_at) as day,
       count(*) as turns,
       count(*) filter (where t.outcome = 'answered') as answered,
       count(*) filter (where t.outcome = 'not_found') as not_found,
       count(*) filter (where t.outcome in ('error', 'limit')) as failed,
       count(f.ask_id) filter (where f.rating = 'up') as up,
       count(f.ask_id) filter (where f.rating = 'down') as down
from ai_ask_traces t
left join ai_ask_feedback f on f.ask_id = t.id
group by 1
order by 1 desc;
```

The down rate and the rephrase rate, by prompt version and model. A down rate is over rated answers, which are a small share of all answers, so read it beside the count:

```sql
select t.prompt_version, t.model,
       count(*) as turns,
       count(f.ask_id) as rated,
       round(100.0 * count(f.ask_id) filter (where f.rating = 'down')
             / nullif(count(f.ask_id), 0), 1) as down_pct,
       round(100.0 * count(*) filter (where t.is_rephrase) / count(*), 1) as rephrase_pct
from ai_ask_traces t
left join ai_ask_feedback f on f.ask_id = t.id
group by 1, 2
order by turns desc;
```

Why answers were marked down:

```sql
select coalesce(f.reason, 'no reason given') as reason, count(*)
from ai_ask_feedback f
where f.rating = 'down'
group by 1
order by 2 desc;
```

The costliest turns of the last week:

```sql
select t.id, t.started_at, t.prompt_version, t.model, t.outcome,
       t.rounds, t.tool_calls, t.duration_ms,
       round(t.cost_micro_usd / 1e6, 4) as cost_usd
from ai_ask_traces t
where t.started_at > now() - interval '7 days'
order by t.cost_micro_usd desc
limit 20;
```

The tools that fail, and how:

```sql
select s.tool, s.outcome, count(*) as calls,
       round(avg(s.duration_ms)) as avg_ms
from ai_ask_trace_steps s
where s.kind = 'tool'
group by 1, 2
order by 1, 3 desc;
```

A null `tool` with `unknown_tool` is the model naming a tool it was not offered. `over_limit` is a call the model asked for after the turn had used up its tool calls; it did not run and is not counted in `tool_failures`.

What one marked-down turn did, step by step, to turn a miss into a test case:

```sql
select s.seq, s.round, s.kind, s.tool, s.outcome, s.duration_ms,
       s.arg_bytes, s.result_chars, s.result_sources,
       s.input_tokens, s.output_tokens
from ai_ask_trace_steps s
where s.trace_id = '<ask id>'
order by s.seq;
```

The trace says what the turn did, not what was asked. For the words, the member has to have sent them: `select id from ai_reports where subject_type = 'ask_answer' and subject_id = '<ask id>';` finds the report, if there is one.

## The same numbers in PostHog

Each turn also sends `ai-answer-finished`, one `ai-answer-tool-called` per tool call, and the thumbs and taps send `ai-answer-rated`, `ai-answer-rating-cleared` and `ai-answer-signal`. Their properties are listed in [`spec/behavior/observability.md` § AI answer events](../../spec/behavior/observability.md#ai-answer-events). PostHog is the place for trends and funnels (how often a source is opened, Try again after a down); the database is the place to join a thumbs to its turn's steps. A chapter that has turned analytics off sends no events, and its traces are still kept.
