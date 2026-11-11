### ADR-28: AI platform — two providers behind a port Frapp owns, one model per feature, a bake-off decides (2026-11-11)

**Status: Current.** Paul took every decision below on 2026-11-11, in the chat thread "Plan Frapp's
AI architecture". Decisions 5, 7 and 9 are his own answers to the privacy research. Decisions 4, 3,
6 and 8 are the plan's recommendations, which he accepted together. The rest follow from those and
were listed in the plan as defaults he could object to. The wording here is the drafting session's.
Nothing in this record is built: there is no `ai` module in `apps/api/src/modules`, no AI SDK in any
`package.json`, and no vector or usage table in `supabase/migrations/`.

This record resolves [#2534](https://github.com/pdcarlson/Frapp/issues/2534) (the AI ADR),
[#1303](https://github.com/pdcarlson/Frapp/issues/1303) (model access) and
[#1456](https://github.com/pdcarlson/Frapp/issues/1456) (embeddings). Work is tracked under the AI
epic, [#427](https://github.com/pdcarlson/Frapp/issues/427).

**Decision.**

1. **One port, one gateway, and no feature imports a provider SDK.** Every model call goes through
   a gateway service in a new `ai` module, behind a provider-neutral port. The gateway checks
   consent, reserves spend against caps before the call, picks the model from a catalog, verifies
   citations, and writes the usage ledger row before it returns. Adapters sit below the port: one
   for Anthropic (`@anthropic-ai/sdk`), one for Google (`@google/genai`), one for transcription, and
   a scripted one for tests that needs no network.
2. **One model per task, named in a catalog.** A feature asks the gateway for a task ("draft
   minutes", "answer with citations", "embed"). The catalog maps the task to a provider and model.
   Changing a feature's model is an edit to the catalog, and the eval suite is what says whether the
   edit is safe.
3. **Both providers, split by job, for the beta.**
   - Claude, on Anthropic's own API, runs the text features: minutes, suggested tasks, and later Ask
     Frapp and the acting agent. It also judges evals.
   - Gemini, on Google Cloud's paid platform (Vertex AI, which Google now calls the Gemini
     Enterprise Agent Platform), runs embeddings from the first day there is an index. It is the
     first candidate for audio and PDF jobs.
   - A bake-off on Frapp's own eval cases decides each feature's model after that. Neither vendor is
     "the" provider.
   - Member data never goes to a free tier, to AI Studio API keys, or to a consumer chat app. Those
     terms allow training on what they receive.
4. **Citations are verified by Frapp's server.** The model returns each claim with a quote and the
   id of the source it came from. The gateway keeps a citation only when the quote appears word for
   word in that source, and drops the claim's citation otherwise. This replaces the rule that
   citations come from the provider's native citation feature. The rule is the same one the eval
   grader already applies (`apps/api/test/ai-evals/harness/grader.ts`).
5. **Chat is part of the AI, with a per-member choice** (Paul). Messages in chapter channels join
   the corpus. A member can say no, and then their messages are left out of indexing and out of
   every model input, and an answer that would have drawn on them says some messages were not
   included. Direct messages and group DMs stay out, always. The rules that make this hold up are in
   [`spec/behavior/ai.md` § Consent](../../behavior/ai.md#consent).
6. **The beta ships minutes from notes first.** An officer pastes or types notes and gets drafted
   minutes with suggested tasks. Uploading a recording on web comes second, after a transcription
   bake-off. The in-app recorder, Ask Frapp and the acting agent come after the beta.
7. **Recording rules** (Paul). Standards meetings are never recorded and never reach a model. Raw
   audio is deleted when the minutes post, and after 30 days if they never post. Frapp stores no
   voiceprint and never recognises a member by voice.
8. **AI text is stored in two cases only.** A member can report an answer, which keeps that one
   exchange for 30 days, encrypted, for the Frapp team to read. During the beta, one chapter can
   have a 14-day diagnostics window with a visible notice. Nothing else stores prompt or answer
   text, and no external sink ever receives it.
9. **Google Cloud holds model calls only** (Paul: "no set date" for anything more). The calls run
   from two new projects, `frapp-ai-staging` and `frapp-ai-prod`. Hosting stays where
   [ADR-24](adr-24.md) put it, on that ADR's triggers. This record adds a vendor and changes nothing
   in ADR-24.
10. **Frapp owns the state.** No provider-side store holds chapter content: no File Search, no Files
    API, no managed retrieval corpus. No agent framework owns the loop or its memory. The usage
    ledger, the prompts, the search index, the job queue and the suggestions are Frapp's tables and
    Frapp's code.
11. **A suggestion never acts by itself.** Anything the AI proposes (a task, a decision to log, a
    field value) is a saved proposal. Accepting it checks the accepter's permission again and
    commits through the ordinary service. Proposals are never posted into chat as messages.
12. **No new observability vendor for the beta.** Sentry keeps exceptions and traces, with model
    inputs and outputs recording off. PostHog gets hand-built events that carry counts, timings,
    model and cost, and no text. The ledger is the spend record.

**Context.** Paul asked for a plan that makes AI "a major part" of Frapp without boxing in later
features. He leaned toward Gemini, has Anthropic API credits that last through the beta and a
one-time Google Cloud trial credit, and expects more of the stack to move to Google Cloud "at some
point". Research from 2026-10-08 on #2534 and #712 had recommended the direct Anthropic API behind a
port, and had never looked at Gemini. Five research threads redid the work on 2026-11-11: models and
providers, frameworks and agent architecture, observability and spend, voice, and privacy with the
Google Cloud path.

**Why two providers, and why now.**

- **Cost doesn't pick a vendor.** The research priced the spec's usage at one, ten and a hundred
  chapters. At a hundred chapters the monthly figures were about $1,957 on Claude's stronger models
  and $1,631 on Gemini's, or $433 and $545 on each vendor's lean models. The spread between tiers is
  far larger than the spread between vendors. These are estimates: no chapter has used any of it.
- **The beta is free on Claude.** The Anthropic credit covers the whole one-chapter bill, evals
  included. The Google trial credit is small, short, and may not apply to Gemini at all (see
  "Not verified" below).
- **Gemini can't cite the way the spec required.** It returns per-claim citations only when Google
  runs the retrieval. Frapp runs its own retrieval, for the tenant-isolation and deletion reasons in
  [`../README.md` §13](../README.md#13-ai-corpus-architecture-v1). Decision 4 removes that
  dependency, which is what makes decision 3 a real choice per feature.
- **Each vendor has a job it is plainly better placed for.** Claude takes no audio. Gemini has a
  first-party embedding model that truncates to 1,536 dimensions, under pgvector's 2,000-dimension
  index limit, and reads PDFs cheaply.
- **A later move to Google Cloud doesn't force the choice.** Claude is also sold on Google Cloud,
  run by Anthropic and billed by Google, with the same API. An Anthropic organization there is a new
  one, so credits and any retention agreement on the current organization don't carry over.

**Prices the estimates used** (observed 2026-11-11; Claude from Anthropic's published model table,
Gemini from search results because the session could not open Google's pages):

| Model | Input, per million tokens | Output, per million tokens |
| --- | --- | --- |
| Claude Sonnet 5.5 | $2 | $10 |
| Claude Haiku 5.5 | $0.10 | $0.50 |
| Claude Opus 5.5 | $4 | $20 |
| Gemini 3.8 Flash | $1.50 from 2027-01-01, $0.75 until then | $7.50, $3.75 until then |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 |

The catalog names the models. This table is a dated observation, not a pin.

**Rejected alternatives.**

- **Gemini for everything from day one.** It works only with decision 4, it spends real money in
  the beta once the trial ends, and it gives up Claude's verified no-training terms for nothing in
  return yet. Rejected for now, not forever: the bake-off can move any feature to Gemini.
- **Claude for everything.** The October recommendation. It leaves embeddings, audio and bulk PDF
  reading to a second vendor anyway, so the port has to exist either way.
- **A model router or gateway vendor** (OpenRouter and similar). Rejected in October and again here.
  It adds a subprocessor that sees every prompt, and it does not remove the need for a ledger and
  caps Frapp controls.
- **An agent framework.** Vercel's AI SDK, Mastra, LangGraph, Google's ADK and Genkit, and the
  Claude Agent SDK were each read. Frapp's loop is small: call the model, run a permission-checked
  tool, repeat, stop. A framework would own that loop's state and its upgrade schedule. The AI SDK
  was the runner-up and could be used inside an adapter later without changing the port.
- **Provider-run retrieval** (File Search, managed corpora). It moves chapter content into a
  vendor's store, where deletion, per-source permissions and a vendor change all get harder.
- **A dedicated LLM observability product now.** Langfuse, self-hosted, is the candidate at around a
  hundred chapters. Before that, the ledger plus Sentry and PostHog answers the questions that
  matter, and a product that stores prompts would break decision 8.
- **Sending audio straight to a general model for the transcript.** Rejected in favour of a
  transcription step behind its own port, then a text-only summary. A transcript with speaker turns
  is the thing an officer corrects.
- **Chat by three narrow routes.** The privacy research recommended starting with an on-demand
  summary that stores nothing, then a per-channel officer switch. Paul chose the broader rule in
  decision 5, because chat carries much of a chapter's context. The research's reasons are kept in
  the consent rules: an explicit yes, permission-aware retrieval, and chat ranked below official
  sources.
- **Keeping raw audio for re-listening.** A voice archive can't be anonymised when a member deletes
  their account, and several states treat voice as biometric data.

**Consequences.**

- Spec changes ship with this record: [`ai.md`](../../behavior/ai.md) (chat, consent, citations,
  suggestions, stored text), [`meetings.md`](../../behavior/meetings.md) (three ways to capture,
  Standards, audio retention), [`../README.md` §13](../README.md#13-ai-corpus-architecture-v1), and
  the chat section of
  [`ai-prompt-injection.md`](../../../docs/security/ai-prompt-injection.md).
- Two tables are new to the design and serve every feature: a queue of AI runs with a dedupe key,
  claimed by the scheduled-worker pattern the Discord import already uses, and a table of proposals
  waiting for a person. On Google Cloud the queue's trigger becomes Cloud Tasks; the table and the
  job code stay.
- Streamed answers use one versioned event format that web and mobile both read, defined in
  `packages/validation`.
- The eval harness becomes provider-neutral, so the same cases can grade either vendor. That is the
  bake-off.
- Citing calls return prose plus a citation list. A call that needs a strict JSON shape (minutes,
  proposals) is a separate, non-citing call using the provider's structured output mode.
- The consent sheet, the privacy page's subprocessor list and the store answers ship in the same
  release that first sends member data to a model, not before and not after
  ([#3297](https://github.com/pdcarlson/Frapp/issues/3297)).

**What this record does not decide.**

- **Which model each feature ends on.** The bake-off decides, feature by feature.
- **The transcription vendor.** A second bake-off, on one real recorded meeting, between Google's
  transcription model and AssemblyAI. [#712](https://github.com/pdcarlson/Frapp/issues/712) stays
  open for it.
- **The monthly allowance.** [`billing.md`](../../behavior/billing.md#ai-usage-pricing) still reads
  it off real usage.
- **When hosting moves.** ADR-24's triggers.
- **AI over vault content, and AI over rush data.** Both stay out.

**Not verified.** The session could not reach `ai.google.dev` or `docs.cloud.google.com`, so these
rest on search results and should be checked before anything depends on them:

- that the Google Cloud trial credit can't pay for Gemini through AI Studio keys, and stops covering
  Vertex for trials started or upgraded on or after 2026-11-16;
- that keyless sign-in from Render to Google Cloud (Workload Identity Federation) needs Render's Pro
  plan. The fallback is a service-account key in Infisical;
- Google's transcription limits (a 30-minute cap per request with speaker labels, and eight
  speakers).

Anthropic's prices and terms, Google Cloud's term barring generative AI in services likely to be
used by people under 18, and Apple's guidelines 5.1.2(i) and 2.5.14 were read at the source.
