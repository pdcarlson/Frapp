# AI Features

Frapp's AI features (Q&A, summarization, drafting, suggestions) answer from the chapter's own sources and cite every answer. Official sources rank first: minutes, chapter documents and announcements. Chat in chapter channels is also a source, for members who agreed to it.

> **Changed 2026-11-11 (Paul, [ADR-28](../architecture/adr/adr-28.md) decision 5).** This file used to say the chapter chat is not part of the AI corpus in v1, trading cross-conversation synthesis for confidence in every answer. Paul reversed that: chat carries much of a chapter's context, so it is in, with a per-member choice. The confidence concern is kept by the rules in [Chat as a source](#chat-as-a-source): chat ranks below official sources, is cited as chat, and can never trigger an action.

Nothing here is built yet. There is no `ai` module in the API. How the pieces are meant to fit is [`spec/architecture/README.md`](../architecture/README.md) §13 and ADR-28.

## Corpus scope

The AI surface reads from these sources, and only these sources. They divide into two access paths:
**documents are retrieved** from an index, and **live structured data is read through tool calls**.

### Indexed corpus (retrieved)

Prose, embedded once and re-embedded when its source is edited:

| Source                                              | Notes                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Meeting minutes and transcripts                     | Stored with `meeting_type` metadata so the summarizer can vary tone (see [`meetings.md`](meetings.md)). |
| Uploaded chapter documents                          | Bylaws, policies, calendars from Chapter Docs ([`chapter-docs.md`](chapter-docs.md)).  |
| Formal announcements                                | `#announcements` channel messages (officer-posted, all-read, see [`chat/README.md`](chat/README.md#announcements)). |
| Channel messages                                    | Messages in chapter channels, from members who agreed. Ranked below the three rows above. Rules: [Chat as a source](#chat-as-a-source). |

### Live structured data (tool-called, never embedded)

Officer roster, events, dues amounts, points balances, attendance, and contacts are **not indexed**.
The model reads them at answer time by calling the same permission-guarded API endpoints the rest of
the product uses, and the result is injected into the answer as a tool result.

This is a deliberate correction to an earlier design that materialized structured data into the
embedding corpus via a "facts" view. Embedding mutable rows has two failure modes an index cannot
fix: an answer is only ever correct as of the last reindex, and an embedded row cannot be aggregated
("how many members are behind on dues?" is a query, not a similarity match). Reading through tools
makes structured answers correct at the moment they are given, and it inherits the caller's
permissions for free rather than reimplementing them at the index layer.

It also follows directly from the non-goal below: structured data already *is* canon, so the AI
should query canon rather than keep a stale copy of it.

> **The mobile s17 mock flattens this split, deliberately and mock-only.**
> `apps/mobile/lib/ask/corpus.ts` answers from a single keyword table that mixes events
> and dues amounts in with the indexed prose, because there is no `ai` module in
> the API to route a tool call through. It exists so the *screen* — citation chips, the
> refusal path, the in-flight state — is real and reviewable against the drawing, and it
> is off unless a build sets `EXPO_PUBLIC_ASK_ENABLED`: nothing in the repo sets it, and an
> EAS `production` build refuses to evaluate its config when it is on
> (`apps/mobile/app.config.js`; [`../ui/mobile/screens.md`](../ui/mobile/screens.md) s17). **A real
> implementation MUST NOT copy that shape.** The two access paths above are the contract;
> the flattened table is scaffolding to be deleted, not extended, the moment Ask can be
> turned on for a real chapter.

## Chat as a source

Messages in chapter channels are part of the corpus: general, committee, role-gated and topic channels alike. `#announcements` was already a source and stays an official one.

- **Only from members who said yes.** A message is indexed, and sent to a model, only when its author accepted the member sheet in [Consent](#consent). Everyone else's messages are left out of the index and out of every model input.
- **Answers say what was left out.** When an answer or summary draws on a channel or thread that holds left-out messages, it says so in plain words, for example "4 messages from members who opted out aren't included". It never says who.
- **A member's name is not their messages.** Name, role and tags are roster data, read through tools. A mention of an opted-out member in someone else's message still resolves.
- **Answers follow the asker's access.** Retrieval returns a message only if the asker could open its channel. A private or role-gated channel never leaks through an answer.
- **Chat ranks below official sources and is cited as chat.** The citation names the channel, the date and the author, and links to the message. When chat disagrees with a bylaw, minutes or an announcement, the answer shows both, as [Citation requirement](#citation-requirement) says for any conflict.
- **Chat never triggers an action.** Any member can write chat, so it is the easiest place to plant an instruction. Nothing is done because a message asked for it, and every action needs the asker's own confirmation.
- **Imported Discord messages count only for linked members who said yes.** An imported author never saw a sheet. Their messages are included only when the author is linked to a Frapp member ([`chat/README.md` § Linking a member's Discord history](chat/README.md#linking-a-members-discord-history), #2878) and that member said yes.
- **Edits, deletes and changes of mind are followed.** An edited message is re-indexed and a deleted one is dropped. A member who turns the choice off stops being read from that moment, and their message embeddings are purged within a day. Deleting an account counts as turning it off.

## Explicit non-goals (v1)

- **DMs are excluded.** Direct messages and group DMs are never part of the AI corpus, whatever a channel or a member has chosen.
- **No "Canon" data model.** Structured chapter data already serves as canon (the dues amount is a field; the officer roster is a table); the AI defers to it by querying it through tools. No additional "chapter facts" surface — and no materialized copy of it in the index — is introduced in v1.
- **No rush or prospective-member data reaches a model.** Rush can include people under 18, and a provider's terms bar that ([ADR-28](../architecture/adr/adr-28.md)).
- **No location reaches a model.** Study-hours location is never an input.
- **Standards meetings never reach a model.** See [`meetings.md`](meetings.md#standards-meetings).

## Consent

Three things must all be true before a member's data reaches a model.

1. **The chapter turned the feature on.** The president switches on each family separately: Ask, meeting notes, and chat as a source. Each is off until then.
2. **The member said yes, once, on a sheet.** The sheet names each provider and each kind of data that is sent: the member's own questions, chapter documents and announcements, roster fields (name, role, points and dues status, with no contact details), messages in channels, and meeting audio and transcripts. It has a real No.
   - Adding a provider or a kind of data makes a new version of the sheet, and every member is asked again.
   - A member who has not answered counts as No. That covers everyone who joined before the sheet existed.
   - The answer is checked on the server, never only in the app.
   - A member can change the answer later in Settings.
3. **A meeting was announced before it was recorded.** See [`meetings.md`](meetings.md#recording-notice).

What No means for that member:

| Area | Effect |
| --- | --- |
| Ask and summaries | They can't use them. |
| Their chat messages | Left out, as [Chat as a source](#chat-as-a-source) says. |
| Their roster fields | Still appear in an officer's tool results. A question like "who is behind on dues" needs every member, and the fields carry no contact details. |
| Meetings | They can ask the officer not to record, and the officer then doesn't. |

The sheet is asked up front because Apple requires an explicit yes before personal data goes to a third-party AI (App Review Guideline 5.1.2(i)). The sheet, the privacy page's list of providers and the store answers ship in the same release that first sends member data to a model ([#3297](https://github.com/pdcarlson/Frapp/issues/3297)).

## Citation requirement

Every AI answer must cite the underlying source inline — author or document title, date, and link to the source. This is both an honesty guarantee and the safety valve: when the AI gets it wrong, the user can see the citation and discount the answer.

Frapp's server checks every citation. The model returns each cited claim with a quote and the id of the source it took the quote from. The server keeps the citation only when the quote appears word for word in that source, and drops it otherwise. A claim left with no citation is shown as unsupported or removed, never dressed up. See [`spec/architecture/README.md`](../architecture/README.md) §13 for the mechanism.

> **Changed 2026-11-11 (Paul, [ADR-28](../architecture/adr/adr-28.md) decision 4).** Citations used to come from the model provider's native citation support. Only one provider offers that for sources Frapp retrieves itself, so the rule tied Ask to that provider. The check is now Frapp's own, and it is the same rule the eval grader applies.

The model is also prompted to surface conflicts ("I see two different answers — the November dues notice says $225, the September one said $200") rather than synthesize them away, and to say "I don't know" when the corpus is silent.

## Suggestions

Some features propose instead of answer: a task drafted from minutes, a decision worth logging, a value for a form field.

- **A suggestion is a proposal, and nothing changes until a person accepts it.** Accepting checks that person's permission again, at that moment, and then makes the change the ordinary way.
- **Suggestions are never posted into chat as messages.** They appear where they belong (on the minutes, on the task list) and in one "Suggested" list for officers.
- **One notification per batch.** Ten suggested tasks from one meeting are one push, not ten.
- **A suggestion shows why.** It carries the quote or the source it came from.
- **Unaccepted suggestions expire.** A suggestion whose source is deleted goes with it.

## Stored AI text

Frapp does not keep the text of prompts or answers, with two exceptions.

| Exception | What is kept | Who reads it | How long |
| --- | --- | --- | --- |
| A member reports an answer | That one exchange, shown to the member before they confirm | The Frapp team | 30 days, encrypted |
| Beta diagnostics | Questions and answers in Ask, for one chapter | The Frapp team | 14 days, encrypted, with a fixed end date |

- The diagnostics window exists for the beta only. While it is on, Ask shows a line saying answers are being saved. It never covers chat-derived or meeting features.
- Neither store holds meeting audio or Standards material.
- Both are deleted when the member deletes their account, and both are named on the privacy page.
- The usage ledger has no text column. It records counts, the model, the prompt version and the cost.
- No prompt or answer text goes to any outside service: not to error tracking, not to analytics, not to a provider's own request logs. That rule has no exception ([`observability.md`](observability.md)).

A provider can hold a request for a short time to check for abuse, on its own terms. Frapp can't delete that copy, so the privacy page says so.

## Providers

Frapp does not promise members one AI vendor. Which provider and model runs each feature is an engineering choice recorded in [ADR-28](../architecture/adr/adr-28.md), and the member sheet names every provider in use. Member data never goes to a free tier or to a consumer AI app.

## Vault-aware AI

Documents in the [vault](vault.md) (encrypted risk / standards content) are NOT in the AI corpus by default. Surfacing vault content via AI requires an additional explicit consent flow per chapter and is deferred to v2+.

## Pricing

AI usage is bundled into the paid tier with a monthly allowance; overage is at-cost passthrough. See [`billing.md`](billing.md) for the allowance + overage rules.
