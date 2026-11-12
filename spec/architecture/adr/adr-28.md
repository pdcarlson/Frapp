### ADR-28: AI platform — two providers behind a port Frapp owns, one model per feature, a bake-off decides (2026-11-11)

**Status: Current.** Paul took the decisions below on 2026-11-11, in the chat thread "Plan Frapp's
AI architecture". Three are his own answers to the privacy research: chat is part of the AI and a
member can opt out (5), recordings go as planned (7), and there is no set date for Google Cloud (9).
Decisions 3, 4, 6 and 8 are the plan's recommendations, which he accepted together. The rest follow
from those and were listed in the plan as defaults he could object to. The wording here is the
drafting session's, and so are the detailed rules under decision 5, which says where they differ
from what he said. As of 2026-11-11 nothing in this record is built: there is no `ai` module in
`apps/api/src/modules`, no AI SDK in any `package.json`, and no vector or usage table in
`supabase/migrations/`.

> **Updated 2026-11-12 ([#4306](https://github.com/pdcarlson/Frapp/issues/4306)).** The gateway of
> decisions 1, 2, 4 and 12 is built: the `ai` module, the port, the model catalog, the Anthropic
> and scripted adapters, the quote check and the content-free telemetry. It is off unless the
> server sets `AI_ENABLED=true`, and no feature calls it yet. Consent, the caps and the ledger are
> still to come; the gateway asks for each through an interface that allows everything today.
>
> **Updated 2026-11-12 ([#4311](https://github.com/pdcarlson/Frapp/issues/4311)).** The Google
> adapter of decision 1 is built on `@google/genai`, in Vertex AI mode with a service account and no
> API-key path. It is off until `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_CREDENTIALS_JSON` are set.
> The eval harness is provider-neutral and the bake-off command exists; its first paid run waits on
> the credentials, so "Not verified" below still stands.
>
> **Updated 2026-11-12 ([#714](https://github.com/pdcarlson/Frapp/issues/714)).** The ledger and
> the caps of decision 1 are built: `ai_usage_events`, one row per provider call, held before the
> call against the chapter's month, the member's day and the provider's month, and settled before
> the gateway returns ([`billing.md` § Caps](../../behavior/billing.md#caps)).
>
> **Updated 2026-11-12 ([#4308](https://github.com/pdcarlson/Frapp/issues/4308)).** Consent is built:
> the gateway refuses every call unless the chapter has switched the call's family on and the member
> it acts for said yes on the current AI sheet ([`ai.md` § Consent](../../behavior/ai.md#consent)).
>
> **Updated 2026-11-12 ([#720](https://github.com/pdcarlson/Frapp/issues/720)).** The index and the
> retrieval of decision 3 are built for chapter documents and posted minutes
> ([`../README.md` §13](../README.md#what-is-built-2026-11-12-720)). Two of the points under "What
> this record does not decide" were settled with it and are marked there: how retrieval is isolated,
> and the index type. Both wait on Paul's read of the pull request. Indexing a chapter's own records
> needs the chapter's switch and no member's yes; embedding a member's question needs that member's
> yes. Chat is not indexed yet (#4314), and nothing calls retrieval until Ask (#450).

This record answers [#1303](https://github.com/pdcarlson/Frapp/issues/1303) (model access) and
[#1456](https://github.com/pdcarlson/Frapp/issues/1456) (embeddings and rerank). It is the ADR
[#2534](https://github.com/pdcarlson/Frapp/issues/2534) asked for, and records that issue's
decisions 1, 2, 3, 6 and 7. Its decisions 4 (how retrieval is isolated per chapter) and 5 (the eval
gate's thresholds) are not settled here: see "What this record does not decide". Work is tracked
under the AI epic, [#427](https://github.com/pdcarlson/Frapp/issues/427).

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
     Enterprise Agent Platform), runs embeddings from the first day there is an index: Gemini
     Embedding at 1,536 dimensions. It is the first candidate for bulk PDF reading, and Google's
     transcription model is one of the two candidates for transcription (decision 6).
   - Retrieval is hybrid: a vector search and Postgres full-text search, merged by reciprocal rank
     fusion. There is no reranker in the first version, as a deliberate cut. One is added only if
     the retrieval evals show misses, and Google's ranking API is the first candidate because it
     adds no vendor.
   - A bake-off on Frapp's own eval cases decides each feature's model after that. Neither vendor is
     "the" provider.
   - Member data never goes to a free tier, to AI Studio API keys, or to a consumer chat app. Those
     terms allow training on what they receive.
4. **Citations are verified by Frapp's server.** The model returns each claim with a quote and the
   id of the source it came from. The gateway keeps a citation only when the quote appears word for
   word in that source, and drops the claim's citation otherwise. This replaces the rule that
   citations come from the provider's native citation feature. The rule is the same one the eval
   grader already applies (`apps/api/test/ai-evals/harness/grader.ts`).
5. **Chat is part of the AI, and a member can keep their messages out** (Paul). Messages in chapter
   channels join the corpus. In his words, chat "should be part of the AI somehow", and "members
   could choose to opt out", with their messages marked as opted out. Direct messages and group DMs
   stay out, always, as they did before.

   The rules that carry this out came from the privacy research, not from Paul, and he had not
   objected to them when this was written. They differ from his sketch in two ways, on purpose:
   - **A member is asked once, and silence counts as no.** He described opting out. Apple requires
     an explicit yes before personal data goes to a third-party AI (App Review Guideline 5.1.2(i)),
     so a default of yes is not available on iOS. A chapter therefore starts with no chat in the
     corpus and gains it member by member.
   - **An answer says how many messages were left out, and never whose.** He described a notice on
     the member's messages. Marking them would show the chapter who said no.

   The president also turns chat on as a source for the chapter, separately from the other AI
   features. All of it is in [`spec/behavior/ai.md` § Chat as a source](../../behavior/ai.md#chat-as-a-source)
   and [§ Consent](../../behavior/ai.md#consent).
6. **The beta ships minutes from notes first.** An officer pastes or types notes and gets drafted
   minutes with suggested tasks. Uploading a recording on web comes second, after a transcription
   bake-off. The in-app recorder, Ask Frapp and the acting agent come after the beta.
7. **Recording rules** (Paul). Standards meetings are never recorded and never reach a model. Raw
   audio is deleted when the minutes post, and after 30 days if they never post. Frapp stores no
   voiceprint and never recognises a member by voice.
   Overridden in #712 by pdcarlson's recording-upload session, 2026-11-12; pending Paul: the audio
   is deleted sooner, as soon as the transcript is written or the transcription fails for good,
   because nothing built reads it after that
   ([`meetings.md` § Retention](../../behavior/meetings.md#retention)).
8. **AI text is stored in two cases only.** A member can report an answer or a draft, which keeps
   that one exchange for 30 days, encrypted, for the Frapp team to read. During the beta, one
   chapter can have a 14-day diagnostics window on Ask, with a visible notice. The research that
   proposed the window kept it off meeting and chat-derived features, so it has nothing to keep
   until Ask exists, and Ask comes after the beta (decision 6). Until then the report is the only
   stored text. Nothing else stores prompt or answer text, and no external sink ever receives it.
   Overridden in #4312 by pdcarlson's drafting session, 2026-11-12; pending Paul: an officer's
   notes for drafted minutes, and what the draft is checked against, are kept beside the unposted
   minutes and deleted when they post, at most 30 days
   ([`meetings.md` § Drafting from notes](../../behavior/meetings.md#drafting-from-notes)).
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
- **A third vendor for embeddings.** Voyage's model is good and cheap, and it would add a vendor and
  a credential for no measured gain. OpenAI's and Cohere's embeddings were not evaluated.
- **A reranker in the first version.** At one chapter's corpus, hybrid retrieval is likely enough.
  That is an estimate, and the retrieval evals are what would overturn it
  ([#3286](https://github.com/pdcarlson/Frapp/issues/3286)).
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

- Spec changes ship with this record: [`ai.md`](../../behavior/ai.md) (chat, consent, whose access
  a run uses, citations, suggestions, stored text), [`meetings.md`](../../behavior/meetings.md)
  (three ways to capture, who can read minutes, Standards, audio retention),
  [`../README.md` §13](../README.md#13-ai-corpus-architecture-v1),
  [`positioning.md`](../../product/positioning.md), and the corpus, chat and citation parts of
  [`ai-prompt-injection.md`](../../../docs/security/ai-prompt-injection.md).
- Three rules in those specs go further than anything Paul was asked, because the specs could not
  be made consistent without them. Each is marked in place as the drafting session's, and is his to
  change: a meeting's minutes are read by the members its event invites, and are no longer posted
  as text into a shared `#meetings` channel; a member's contact details are never returned to a
  model; and announcements and documents an officer posted stay readable by AI when that officer's
  own answer on the sheet is no, because they are the chapter's records.
- Two tables are new to the design and serve every feature: a queue of AI runs with a dedupe key,
  claimed by the scheduled-worker pattern the Discord import already uses, and a table of proposals
  waiting for a person. On Google Cloud the queue's trigger becomes Cloud Tasks; the table and the
  job code stay.
- Streamed answers use one versioned event format that web and mobile both read, defined in
  `packages/validation`.
- The eval harness becomes provider-neutral, so the same cases can grade either vendor. That is the
  bake-off ([#4311](https://github.com/pdcarlson/Frapp/issues/4311)).
- No pull request calls a paid model by default. Every pull request grades Frapp's own enforcement
  (citation grounding, chapter scoping, the authority ceiling) against the scripted adapter, and CI
  sets `AI_EVALS_REQUIRE_AGENT=1` once that adapter exists
  ([#4306](https://github.com/pdcarlson/Frapp/issues/4306)). What only a live model can show
  (refusals, resisting an injection) is graded by live runs outside the pull-request path
  ([#3282](https://github.com/pdcarlson/Frapp/issues/3282)). This answers #1303's CI question.
- Citing calls return prose plus a citation list. A call that needs a strict JSON shape (minutes,
  proposals) is a separate call using the provider's structured output mode. The quote a proposal
  carries gets the same word-for-word check as a citation.
- The credentials are Paul's to create: the Anthropic organization
  ([#3279](https://github.com/pdcarlson/Frapp/issues/3279)) and the Google Cloud projects
  ([#4316](https://github.com/pdcarlson/Frapp/issues/4316)).
- The consent sheet, the privacy page's subprocessor list and the store answers ship in the same
  release that first sends member data to a model, not before and not after
  ([#3297](https://github.com/pdcarlson/Frapp/issues/3297)).

**What this record does not decide.**

- **Which model each feature ends on.** The bake-off decides, feature by feature.
- **The transcription vendor.** A second bake-off, on one real recorded meeting, between Google's
  transcription model and AssemblyAI. [#712](https://github.com/pdcarlson/Frapp/issues/712) stays
  open for it.
  - Added 2026-11-12 (#712, pending Paul): the upload and both adapters are built, and the bake-off
    has not run. Until it does, the catalog routes `meetings.transcribe` to AssemblyAI, because a
    two-hour recording is one request there and four or more under Google's 30-minute cap. That is
    a default to be confirmed or replaced by the bake-off, not the decision. The audio is deleted
    when the transcript is written, sooner than decision 7's wording; the reason is in
    [`meetings.md` § Retention](../../behavior/meetings.md#retention).
- **The monthly allowance.** [`billing.md`](../../behavior/billing.md#ai-usage-pricing) still reads
  it off real usage.
- **When hosting moves.** ADR-24's triggers.
- **How retrieval is isolated per chapter** (#2534's decision 4). The rule is stated in
  [`../README.md` §13](../README.md#13-ai-corpus-architecture-v1): one chapter per request, and a
  read check per source. Whether the retrieval function also runs under the caller's own database
  identity, so row-level security backs the filter, is open. The October research recommended it.
  The API reads with the service role today, which bypasses row-level security, and a background
  job has no caller. It is settled with the corpus schema
  ([#720](https://github.com/pdcarlson/Frapp/issues/720)).
  - **Settled 2026-11-12 in #720, pending Paul.** Retrieval does not run under a member's database
    token. The API has no client that carries one (the anon key is deliberately not loaded), and a
    background run has no token at all, so a rule that lived in row-level security would not cover
    the runs that most need it. What the research wanted from it is kept another way: the one
    function that reads passages takes the chapter and the acting member, and returns nothing unless
    that member belongs to that chapter. If it is ever called with a member's token, the token must
    be the acting member's. Row-level security stays on with no policies, only the service role may
    run the function, and the migration gate proves the isolation cases against the real SQL.
- **The eval gate's thresholds and how often live models run** (#2534's decision 5). #3282 owns
  both. The research recommended manual runs plus runs on pull requests that touch prompts,
  retrieval or the catalog during the beta, and nightly from about ten chapters.
- **The vector index type and the database plan it needs.** Settled with the corpus schema (#720).
  - **Settled 2026-11-12 in #720, pending Paul.** No approximate index in the first version, so no
    change of database plan. One chapter holds a few thousand passages, and an exact scan of one
    chapter's rows is fast and always right. An approximate index spans every chapter and is
    filtered by chapter afterwards, so it returns mostly other chapters' neighbours and loses recall
    as chapters are added. HNSW with pgvector's iterative scan is the later, additive step once one
    chapter passes about 20,000 passages. The word half has a GIN index.
- **AI over vault content, rush data and backwork.** All three stay out.
  [`ai.md`](../../behavior/ai.md)'s list of sources is closed.

**Not verified.** The session could not reach `ai.google.dev` or `docs.cloud.google.com`, so every
statement about Google in this record rests on search results. Two of them carry a decision, and
should be read at the source before the work that depends on them starts:

- that Gemini returns per-claim citations only when Google runs the retrieval. This is the stated
  reason for decision 4. Decision 4 stands without it, because a check Frapp owns works with any
  provider, but the "can't cite" argument for the provider split would weaken;
- that Gemini Embedding can be cut to 1,536 dimensions. The vector column is sized from it, and a
  column can't change width without re-embedding the corpus (#720).

The rest should be checked before anything depends on them:

- that AI Studio keys and the free tier fall under terms that allow training on what they receive,
  and that the paid platform does not;
- that Claude on Google Cloud is run by Anthropic with the same API;
- every Gemini price in the "Prices the estimates used" table, and so the Gemini cost figures;
- that the Google Cloud trial credit can't pay for Gemini through AI Studio keys, and stops covering
  Vertex for trials started or upgraded on or after 2026-11-16;
- that keyless sign-in from Render to Google Cloud (Workload Identity Federation) needs Render's Pro
  plan. The fallback is a service-account key in Infisical;
- Google's transcription limits (a 30-minute cap per request with speaker labels, and eight
  speakers).

Anthropic's prices and terms, Google Cloud's term barring generative AI in services likely to be
used by people under 18, and Apple's guidelines 5.1.2(i) and 2.5.14 were read at the source.
