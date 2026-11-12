# AI Features

Frapp's AI features (Q&A, summarization, drafting, suggestions) answer from the chapter's own sources and cite every answer. Official sources rank first: minutes, chapter documents and announcements. Chat in chapter channels is also a source, for members who agreed to it.

> **Changed 2026-11-11 (Paul, [ADR-28](../architecture/adr/adr-28.md) decision 5).** This file used to say the chapter chat is not part of the AI corpus in v1, trading cross-conversation synthesis for confidence in every answer. Paul reversed that: chat carries much of a chapter's context, so it is in, with a per-member choice. The confidence concern is kept by the rules in [Chat as a source](#chat-as-a-source): chat ranks below official sources, is cited as chat, and can never trigger an action.

How the pieces are meant to fit is [`spec/architecture/README.md`](../architecture/README.md) §13 and ADR-28.

## Corpus scope

The AI surface reads from these sources, and only these sources. They divide into two access paths:
**documents are retrieved** from an index, and **live structured data is read through tool calls**.

### Indexed corpus (retrieved)

Prose, embedded once and re-embedded when its source is edited:

| Source                                              | Notes                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Meeting minutes and transcripts                     | Stored with `meeting_type` metadata so the summarizer can vary tone (see [`meetings.md`](meetings.md)). |
| Uploaded chapter documents                          | Bylaws, policies, calendars from Chapter Docs ([`chapter-docs.md`](chapter-docs.md)).  |
| Formal announcements                                | Top-level posts in `#announcements` (officer-posted, all-read, see [`chat/README.md`](chat/README.md#announcements)). A member's reply in an announcement's thread is a channel message, the row below. |
| Channel messages                                    | Messages in chapter channels, from members who agreed. Ranked below the three rows above. Rules: [Chat as a source](#chat-as-a-source). |

### Live structured data (tool-called, never embedded)

Officer roster, events, dues amounts, points balances and attendance are **not indexed**.
The model reads them at answer time by calling the same permission-guarded API endpoints the rest of
the product uses, and the result is injected into the answer as a tool result.

A member's contact details (phone, email, address) are never returned to a model. (Changed
2026-11-11 with [Consent](#consent): this paragraph used to list contacts among the fields a model
reads. The sheet a member accepts promises no contact details are sent, so the tools don't return
them. An answer can still say who holds a role and link to their profile.)

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
> and dues amounts in with the indexed prose, because there is no tool registry in
> the API to route a tool call through (corrected 2026-11-12: an `ai` module now exists, the
> gateway of #4306, with no tools). It exists so the *screen* — citation chips, the
> refusal path, the in-flight state — is real and reviewable against the drawing, and it
> is off unless a build sets `EXPO_PUBLIC_ASK_ENABLED`: nothing in the repo sets it, and an
> EAS `production` build refuses to evaluate its config when it is on
> (`apps/mobile/app.config.js`; [`../ui/mobile/screens.md`](../ui/mobile/screens.md) s17). **A real
> implementation MUST NOT copy that shape.** The two access paths above are the contract;
> the flattened table is scaffolding to be deleted, not extended, the moment Ask can be
> turned on for a real chapter.

## Chat as a source

Messages in chapter channels are part of the corpus: general, committee, role-gated and topic channels alike. `#announcements` was already a source and stays an official one for its top-level posts. A reply in an announcement's thread, which any reader of the channel can write, is an ordinary channel message under the rules below.

- **Only from members who said yes.** A message is indexed, and sent to a model, only when its author accepted the member sheet in [Consent](#consent). Everyone else's messages are left out of the index and out of every model input.
- **Answers say what was left out.** When an answer or summary draws on a channel or thread that holds left-out messages, it says so in plain words, for example "4 messages from members who opted out aren't included". It never says who.
- **A member's name is not their messages.** Name, role and tags are roster data, read through tools. A mention of an opted-out member in someone else's message still resolves.
- **Answers follow the asker's access.** Retrieval returns a message only if the asker could open its channel. A private or role-gated channel never leaks through an answer.
- **A block holds.** An answer never quotes or cites a member the asker has blocked, as the timeline, search and reply quotes already don't ([`chat/README.md` § What a block does and does not hide](chat/README.md#what-a-block-does-and-does-not-hide)).
- **Chat ranks below official sources and is cited as chat.** The citation names the channel, the date and the author, and links to the message. When chat disagrees with a bylaw, minutes or an announcement, the answer shows both, as [Citation requirement](#citation-requirement) says for any conflict.
- **Chat never triggers an action.** Any member can write chat, so it is the easiest place to plant an instruction. Nothing is done because a message asked for it, and every action needs the asker's own confirmation.
- **Imported Discord messages count only for linked members who said yes.** An imported author never saw a sheet. Their messages are included only when the author is linked to a Frapp member ([`chat/README.md` § Linking a member's Discord history](chat/README.md#linking-a-members-discord-history), #2878) and that member said yes.
- **Edits, deletes and changes of mind are followed.** An edited message is re-indexed and a deleted one is dropped. A member who turns the choice off stops being read from that moment, and their message embeddings are purged within a day. Their words also leave what was made from them: a waiting suggestion loses its quote of them, and a stored report that quotes them is deleted early ([Stored AI text](#stored-ai-text)). Deleting an account counts as turning it off.

## Explicit non-goals (v1)

- **DMs are excluded.** Direct messages and group DMs are never part of the AI corpus, whatever a channel or a member has chosen.
- **No "Canon" data model.** Structured chapter data already serves as canon (the dues amount is a field; the officer roster is a table); the AI defers to it by querying it through tools. No additional "chapter facts" surface — and no materialized copy of it in the index — is introduced in v1.
- **No rush or prospective-member data reaches a model.** Rush can include people under 18, and a provider's terms bar that ([ADR-28](../architecture/adr/adr-28.md)).
- **No location reaches a model.** Study-hours location is never an input.
- **Standards meetings never reach a model.** See [`meetings.md`](meetings.md#standards-meetings).

## Whose access an AI run uses

- **A question uses the asker's access, in one chapter.** That is the chapter the asker is in when they ask. Belonging to a second chapter adds nothing to the answer.
- **Background work acts for a named member.** Drafting minutes acts for the officer who started it. A scheduled feature acts for the officer who turned it on or who will receive its result. The run reads only what that member can open at the moment it runs. A run with no member to act for does not read the corpus.
- **What a run produces is shown only to people who could open its sources.** A suggestion drawn from an Exec meeting or a role-gated channel is listed only for officers who can open that meeting or channel.
- **So is the fact that a run exists.** The member who started a run and the member it acts for can follow its progress ("Drafting minutes") and see how it ended. Anyone else sees it only when they could open what it reads, and otherwise gets the same answer as for a run that does not exist.
- **What a member could do when they asked is checked again when the run runs.** A member who left the chapter, or lost the role the feature needs, in between gets a failed run and nothing is read.
- **Asking again after a run failed tries again.** The same request while a run is waiting or working joins that run rather than starting a second one.

## Consent

Three gates stand between Frapp's data and a model. Each governs a different thing.

1. **The chapter turned the feature on.** The president switches on each family separately: Ask, meeting notes, and chat as a source. Each is off until then. This gate governs the chapter's records, which are the chapter's to share: documents, announcements, minutes and roster fields, whoever uploaded or posted them.
2. **The member said yes, once, on a sheet.** This gate governs what is the member's to share: their own use of AI, and their own messages. The sheet names each provider and every kind of data that is sent, the chapter's records included, so a member knows what leaves Frapp before they answer: the member's own questions, chapter documents and announcements, roster fields (name, role, points, dues status and attendance, with no contact details), messages in channels, and meeting notes, audio and transcripts. It has a real No.
   - Adding a provider or a kind of data makes a new version of the sheet, and every member is asked again.
   - A member who has not answered counts as No. That covers everyone who joined before the sheet existed.
   - The answer is checked on the server, never only in the app.
   - A member can change the answer later in Settings.
3. **A meeting was announced before it was recorded.** This gate governs voices. See [`meetings.md`](meetings.md#recording-notice).

What No means for that member:

| Area | Effect |
| --- | --- |
| Ask and summaries | They can't use them. |
| Their chat messages | Left out, as [Chat as a source](#chat-as-a-source) says. That includes their replies under an announcement. |
| Announcements and documents they posted as an officer | Still read. They are the chapter's records, under the president's switch. |
| Their roster fields | Still appear in an officer's tool results. A question like "who is behind on dues" needs every member, and the fields carry no contact details. |
| Minutes that name them | Still drafted. Notes an officer writes about a meeting are the officer's text, and minutes have always named who said and owes what. |
| A recorded meeting | Their answer on the sheet does not stop a recording. The [recording notice](meetings.md#recording-notice) does: anyone present can object, whatever they answered, and the officer then doesn't record. |

How the first two gates are kept (#4308):

- **The server checks both before every model call.** The AI gateway asks before it sends anything: the call's family must be switched on in the chapter the call is made in, and the member it acts for must have said yes on the current sheet. Nothing is cached, so a switch turned off or an answer changed to No stops the very next call. Indexing and searching the chapter's sources sit behind the Ask switch, since they exist for Ask. Indexing the chapter's records needs only that switch, not a member's Yes: they are the chapter's, whoever uploaded or posted them, so a document from an officer who said No is still indexed. A member's own question is their own use, so it is embedded for a search only after they said yes. Chat as a source is not a call's switch: it decides which messages the corpus reads, and with it off no member's messages are read.
- **Only the president turns the switches on or off.** That is the member holding the chapter's President role. Each change is recorded in the audit log and shows in `#chapter-audit`. Every member can see which switches are on.
- **The sheet is one answer per person, not per chapter.** It names the same providers and the same kinds of data wherever the person is a member, so one Yes covers every chapter they are in, and one No turns AI off for them in all of them. Answering needs no membership, so someone who has left every chapter can still say No and keep their old messages out. The chapter switches stay each chapter's own.
- **The sheet is versioned on the server.** The API serves the current sheet, with its version, the providers and the kinds of data, so an app built before a change still shows the current one. An answer names the version the member was shown, and an answer to a version that is no longer current is refused, so a Yes never covers a provider or a kind of data the member did not see. Each version's answer is kept, so a member asked again can be told the sheet changed.
- **A refused call says why.** A route answers `ai.consent.required` when the member has not said yes, so the app shows the sheet, and `ai.chapter_off` when the president has not turned the feature on, so the app hides it.
- **Who may use AI at all is also a permission.** `ai:use` is in every starting tier of a chapter created from #4308 on, so every active member holds it and Alumni do not ([`rbac.md`](rbac.md)). Chapters created before that grant it from the Roles page.

A No is therefore not a promise that nothing about the member reaches a model. It keeps their own messages out and their own use off. The sheet and the privacy page must say it that way.

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
- **One notification per batch.** Ten suggested tasks from one meeting are one push, not ten. It goes to the member the run acted for, and only when they could accept something in it.
- **A suggestion shows why.** It carries the quote or the source it came from. The server checks the quote word for word against that source, as it does a citation, and the quote is shown only to someone who can open the source.
- **Only people who could accept it see it.** The Suggested list and the in-context lists show a suggestion to a member who holds the permission accepting needs, has the feature's module on, and can open its source, all checked when they look. Accepting checks the same three again.
- **Unaccepted suggestions expire.** A suggestion waits 14 days, then expires. A suggestion whose source is deleted goes with it.
- **A decided suggestion keeps no text.** Accepting, dismissing or expiring a suggestion deletes what the AI wrote in it (the proposal and its quote). Who decided, when, and what it became stay, as the record. Accepting deletes it once the change is made, so an accept that fails leaves the suggestion waiting as it was. So a suggestion stores AI text only while it waits for a person, which is why it isn't one of the exceptions under [Stored AI text](#stored-ai-text).

> **Added 2026-11-12 (#4309, the drafting session's, Paul's to change).** The 14-day wait, the push going only to the member the run acted for, and deleting a decided suggestion's text were not stated before. Fourteen days covers two weekly meetings, so an officer who misses one review still sees its suggestions at the next.

## Stored AI text

Frapp does not keep the text of prompts or answers, with two exceptions.

| Exception | What is kept | Who reads it | How long |
| --- | --- | --- | --- |
| A member reports an answer or a draft | That one exchange, shown to the member before they confirm | The Frapp team | 30 days, encrypted |
| Beta diagnostics | Questions and answers in Ask, for one chapter | The Frapp team | 14 days, encrypted, with a fixed end date |

- The diagnostics window exists for the beta only, and only on Ask. While it is on, Ask shows a line saying answers are being saved. It never covers meeting features, and it never keeps an answer that drew on chat. Ask comes after the beta's first features, so until it exists the window keeps nothing and a report is the only stored text.
- Neither store holds meeting audio or Standards material.
- An officer's notes for drafted minutes are the officer's own input to a feature, not a stored prompt: they are kept beside the unposted minutes so the officer can ask again, with what the officer checks the draft against (what the notes leave out, and each drafted decision and action item beside its line), and are deleted when the minutes are posted ([`meetings.md` § Drafting from notes](meetings.md#drafting-from-notes)). Added 2026-11-12 (#4312, the drafting session's, Paul's to change).
- A stored exchange is deleted when the member who asked or reported deletes their account. It is also deleted early when a member it quotes deletes their account or turns their choice off.
- Both are named on the privacy page.
- The usage ledger has no text column. It records counts, the model, the prompt version and the cost.
- No prompt or answer text goes to any outside service: not to error tracking, not to analytics, not to a provider's own request logs. That rule has no exception ([`observability.md`](observability.md)).

A provider can hold a request for a short time to check for abuse, on its own terms. Frapp can't delete that copy, so the privacy page says so.

## Providers

Frapp does not promise members one AI vendor. Which provider and model runs each feature is an engineering choice recorded in [ADR-28](../architecture/adr/adr-28.md), and the member sheet names every provider in use. Member data never goes to a free tier or to a consumer AI app.

## Vault-aware AI

Documents in the [vault](vault.md) (encrypted risk / standards content) are NOT in the AI corpus by default. Surfacing vault content via AI requires an additional explicit consent flow per chapter and is deferred to v2+.

## Pricing

AI usage is bundled into the paid tier with a monthly allowance; overage is at-cost passthrough. See [`billing.md`](billing.md) for the allowance + overage rules.
