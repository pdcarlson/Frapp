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

> **The mobile s17 mock that flattened this split is gone** (2026-11-12, #4415). Until then
> `apps/mobile/lib/ask/corpus.ts` answered from one keyword table that mixed events and dues
> amounts in with indexed prose, behind a build flag (`EXPO_PUBLIC_ASK_ENABLED`), so the
> screen could be reviewed before any API existed. This note said a real implementation MUST
> NOT copy that shape and that the table was to be deleted, not extended. It was deleted: the
> phone's Ask calls the same route web's does, and the two access paths above are the only
> ones.

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

- **The server checks both before every model call.** The AI gateway asks before it sends anything: the call's family must be switched on in the chapter the call is made in, and the member it acts for must have said yes on the current sheet. Nothing is cached, so a switch turned off or an answer changed to No stops the very next call. Indexing and searching the chapter's sources sit behind the Ask switch, since they exist for Ask. Indexing the chapter's records needs only that switch, not a member's Yes: they are the chapter's, whoever uploaded or posted them, so a document from an officer who said No is still indexed. A member's own question is their own use, so it is embedded for a search only after they said yes. Chat as a source is not a call's switch: it decides which messages the corpus reads and whether a summary may read a channel ([Catch me up](#catch-me-up), 2026-11-12), and with it off no member's messages are read.
- **Only the president turns the switches on or off.** That is the member holding the chapter's President role. Each change is recorded in the audit log and shows in `#chapter-audit`. Every member can see which switches are on.
- **The sheet is one answer per person, not per chapter.** It names the same providers and the same kinds of data wherever the person is a member, so one Yes covers every chapter they are in, and one No turns AI off for them in all of them. Answering needs no membership, so someone who has left every chapter can still say No and keep their old messages out. The chapter switches stay each chapter's own.
- **The sheet is versioned on the server.** The API serves the current sheet, with its version, the providers and the kinds of data, so an app built before a change still shows the current one. An answer names the version the member was shown, and an answer to a version that is no longer current is refused, so a Yes never covers a provider or a kind of data the member did not see. Each version's answer is kept, so a member asked again can be told the sheet changed.
- **A refused call says why.** A route answers `ai.consent.required` when the member has not said yes, so the app shows the sheet, and `ai.chapter_off` when the president has not turned the feature on, so the app hides it.
- **Who may use AI at all is also a permission.** `ai:use` is in every starting tier of a chapter created from #4308 on, so every active member holds it and Alumni do not ([`rbac.md`](rbac.md)). Chapters created before that grant it from the Roles page.

Where the sheet appears (#4308's screens, web first):

- **At the first AI entry point a member reaches**, not on sign-in. The way iOS asks for the camera when a member first taps the camera, each AI feature asks before its first call. On web every AI entry point calls `useAiConsentGate` (the minutes screen is the first to): a member who said yes goes straight through, anyone else is shown the sheet, and the feature goes ahead only on Yes. Closing the sheet is not an answer, so nothing is recorded and the next AI entry point asks again. In the beta the only AI feature is an officer's (minutes from notes), so asking every member at sign-in would ask most of them about something they never see.
- **In personal Settings, under My account, as AI** ([`../ui/web-dashboard/README.md`](../ui/web-dashboard/README.md) lists the sections). The whole sheet is on the page under one switch, "Use AI features", with the answer and its date ("You said yes on November 12, 2026."), so turning it on there is as informed as answering the sheet. Turning it off is a No.
- **Neither shows while the server has AI off.** Both wait for `GET /v1/ai/consent`, which answers 404 `ai.not_available` then.
- The sheet's rows (providers and kinds of data) come from the server; the framing around them (the title, what No means, the buttons) is `AI_CONSENT_COPY` in `@repo/validation`, shared by web and mobile. Yes and No are the same size side by side, and No is a real button, never a link.

A No is therefore not a promise that nothing about the member reaches a model. It keeps their own messages out and their own use off. The sheet and the privacy page must say it that way.

The sheet is asked up front because Apple requires an explicit yes before personal data goes to a third-party AI (App Review Guideline 5.1.2(i)). The sheet, the privacy page's list of providers and the store answers ship in the same release that first sends member data to a model ([#3297](https://github.com/pdcarlson/Frapp/issues/3297)).

## Citation requirement

Every AI answer must cite the underlying source inline — author or document title, date, and link to the source. This is both an honesty guarantee and the safety valve: when the AI gets it wrong, the user can see the citation and discount the answer.

Frapp's server checks every citation. The model returns each cited claim with a quote and the id of the source it took the quote from. The server keeps the citation only when the quote appears word for word in that source, and drops it otherwise. A claim left with no citation is shown as unsupported or removed, never dressed up. See [`spec/architecture/README.md`](../architecture/README.md) §13 for the mechanism.

> **Changed 2026-11-11 (Paul, [ADR-28](../architecture/adr/adr-28.md) decision 4).** Citations used to come from the model provider's native citation support. Only one provider offers that for sources Frapp retrieves itself, so the rule tied Ask to that provider. The check is now Frapp's own, and it is the same rule the eval grader applies.

The model is also prompted to surface conflicts ("I see two different answers — the November dues notice says $225, the September one said $200") rather than synthesize them away, and to say "I don't know" when the corpus is silent.

## Ask Frapp

A member asks a question in their own words and gets an answer from what they could open themselves, with each claim tied to its source. Built 2026-11-12 on web (#450, #451) and on the phone (#4415; the sheet is [`../ui/mobile/screens.md`](../ui/mobile/screens.md) s17, with the same words and the same answer cutting as web). On the phone a channel-message source opens its channel at the newest message, since the channel screen has no jump-to-message yet. It is off unless the server has `AI_ENABLED` on and the chapter's president has turned Ask on, and it needs the member's yes on the AI sheet.

- **Where it is.** The Ask pill in the web top bar opens a panel on the right edge that leaves the page usable beside it ([`../ui/web-dashboard/README.md`](../ui/web-dashboard/README.md) § Top bar). With Ask off for the chapter, or for a member without `ai:use`, there is no pill.
- **One question, one answer.** Each question is answered on its own. Ask keeps no conversation, and the panel says so under the field. Follow-up questions that build on the last answer are not built.
- **How an answer is made.** The question searches the chapter's index as the asker ([Corpus scope](#corpus-scope)), and in parallel a small planning call picks which live-data tools the question needs from the ones this member may use. The tools run as the asker. One writing call then sees the tool results, the official passages and the chat passages, in that order, and must quote the source for each claim.
- **Live data is read through tools, never the index:** the roster (names and roles, no contact details), upcoming events, the asker's own points and the leaderboard, and the asker's own dues. Each tool mirrors a route, needs that route's permission and module, and only reads. A tool that would change something is never offered to Ask; the seam for one that proposes a change is the acting agent's (#718). Attendance and "who is behind on dues" have no tool yet.
- **No answer without a source.** The server checks every quote against its source ([Citation requirement](#citation-requirement)). An answer left with no checked citation is not shown: the member reads "I couldn't find that in your chapter's documents, minutes or records." When some quotes were dropped and others stood, the answer says part of it could not be matched.
- **What streams is a preview.** Text appears as it is written, under the step the server is on ("Searching your chapter's sources", "Reading what it found", "Writing"). The server decides what stands after the model stops, and the checked answer replaces the preview.
- **Sources open.** Each cited sentence carries a numbered marker, and the sources are listed under the answer with their kind, place and full date. A document opens in the viewer, minutes open the meeting, a channel message opens in its channel, and live data opens its page. Live data has no date; it says "Read just now".
- **Left-out messages are counted, never named.** When the channels an answer drew on hold messages from members who have not agreed, the answer says how many were not included.
- **When it can't answer** it says which: the member has not answered the AI sheet (with a button that opens it), the president turned Ask off, the chapter or the member reached its allowance, or Ask is not available. A provider refusal reads "Ask can't help with that question."
- **The stream format is versioned and defined once,** in `@repo/validation` (`ask.ts`), for the API that writes it and for web and mobile that read it. A reader ignores an event type, a key or a source kind it does not know, so an installed mobile build keeps working when the format grows.
- **Limits.** A question is at most 1,000 characters. Ten questions a minute per member, on top of the spend caps.

> **Added 2026-11-12 (#450, the building session's, Paul's to change).** Not stated before: single questions with no follow-ups; the pill hidden rather than disabled when the president has Ask off; no relevance threshold (the no-source rule is the only "couldn't find it" test); an event's location text is given to the model; and the rate of ten a minute.

## Catch me up

A member back to a busy channel asks for the short version and gets a few lines, each tied to the message it came from. Built 2026-11-12 on web (#3946); mobile follows as its own change. It is off unless the server has `AI_ENABLED` on and the chapter's president has turned on both Ask and "Include channel messages", and it needs the member's yes on the AI sheet.

- **Only when a member asks.** Nothing summarizes in the background, on a schedule, or for a channel nobody asked about. One request is one summary for one reader.
- **Chapter channels only.** Never a direct message, a group DM or the audit log. The reader must be able to open the channel, by the timeline's own check.
- **What it reads.** One of three stretches: the messages that were new when the member opened the channel, the channel's last 24 hours or 7 days, or one thread (a thread under a card or a deleted message is its replies). At most the newest 300 messages, no further back than 30 days, and about 48,000 characters of text; when a stretch is longer, the summary says it read the most recent part.
- **Consent is [Chat as a source](#chat-as-a-source)'s, unchanged.** Only messages whose authors said yes are sent. Everyone else's are left out and the summary says how many, never whose. An imported message nobody linked to a member is left out the same way. A member the reader blocked is left out and not counted, so the count cannot say who.
- **Too little is not summarized.** A stretch with fewer than 5 readable messages is quicker to read than to shorten, so no model is called and the member is told so. When consent is why, it says that.
- **Every line is tied to a message.** A summary is up to 12 points in four groups, shown in this order: For you (asked of the reader, assigned to them, or promised by them), Decided, Dates and reminders, Also discussed. The model must name the one message each point rests on and quote words from it. The server checks every quote against that message, word for word, and drops a point that fails, or whose quote is under 10 characters when the message is longer. That proves where a line came from, not that its sentence is right: the sentence is the model's, which is why pressing it opens the message. Each message is sent as one line, so a message cannot be written to look like someone else's. A summary left with no point is not shown, and one that lost some says part of it could not be matched. Pressing a line opens its message, in its thread when it is a reply.
- **There is no overall paragraph.** A gist nobody can check is the part of a summary most likely to be wrong, so the points are the summary.
- **It proposes nothing.** A decision or a reminder in a summary is a line, never a suggested task, a calendar entry or a notification. Chat never triggers an action ([Chat as a source](#chat-as-a-source)), and a suggestion made from a private read would outlive it.
- **Only the asker sees it, and it is not kept.** The summary is the response to the request. The server stores no summary, no prompt and no point, the beta diagnostics window never covers it, and the client holds it only while the panel is open: closing the panel, leaving the channel or reloading ends it.
- **Report this is the one way any of it is kept.** A summary that stands carries Report this, as every AI-made surface does ([Stored AI text](#stored-ai-text)). The server seals the exchange into the response and forgets it, as it does for an Ask answer; a report hands it back, and only then is it stored: the messages the model read and the summary, encrypted, for 30 days, for the Frapp team. The report names the members whose messages it holds, so it is deleted early when one of them answers No or deletes their account.
- **A message is never an instruction.** The conversation goes to the model as data, with the instructions in the system channel, and the call has no tools. Contact details are not to be repeated.
- **Where it is.** On web: "Catch me up" in the channel's menu, a "Summarize thread" control on a thread of 5 or more messages, and a strip above the timeline when a channel opens with 20 or more new messages ([`../ui/web-dashboard/README.md` § Chat](../ui/web-dashboard/README.md#chat)). With summaries off for the chapter, or for a member without `ai:use`, none of these appear.
- **When it can't** it says which: the member has not answered the AI sheet (with a button that opens it), the president has summaries or channel messages turned off, the chapter or the member reached its allowance, or summaries are not available. A provider refusal reads "This conversation can't be summarized."
- **Limits.** Ten summaries a minute per member, on top of the spend caps. The request, the answer and the words both clients show are defined once, in `@repo/validation` (`chat-catch-up.ts`).

> **Added 2026-11-12 (#3946, the building session's, Paul's to change).** Known limit, flagged in the PR: the left-out count is exact, so a member who asks about a stretch holding one other member's messages can tell from it whether that member said yes. The issue asked for the design to be settled with Paul first; this is the most conservative shape, built so he can change it. Not stated before: points instead of prose, with no overall paragraph; the four groups and their order; no suggestions from a summary; that it rides the Ask switch and the chat switch, with no switch of its own and no new version of the member sheet (the sheet names providers and kinds of data, not features, and messages in channels is already one of its kinds; the "Include channel messages" switch's description now names summaries, so a president knows what it turns on); the reader's blocked members left out uncounted; every number above (5, 12, 20, 300, 30 days, ten a minute); that the author's name goes to the model beside their message, as it does for Ask; and that a reported summary keeps the consenting members' messages it read (the Stored AI text table's first row, applied to summaries).

## Suggestions

Some features propose instead of answer: a task drafted from minutes, a decision worth logging, a value for a form field.

- **A suggestion is a proposal, and nothing changes until a person accepts it.** Accepting checks that person's permission again, at that moment, and then makes the change the ordinary way.
- **Suggestions are never posted into chat as messages.** They appear where they belong (on the minutes, on the task list) and in one "Suggested" list for officers.
- **One notification per batch.** Ten suggested tasks from one meeting are one push, not ten. It goes to the member the run acted for, and only when they could accept something in it.
- **A suggestion shows why.** It carries the quote or the source it came from. The server checks the quote word for word against that source, as it does a citation, and the quote is shown only to someone who can open the source.
- **Only people who could accept it see it.** The Suggested list and the in-context lists show a suggestion to a member who holds the permission accepting needs, has the feature's module on, and can open its source, all checked when they look. Accepting checks the same three again.
- **Unaccepted suggestions expire.** A suggestion waits 14 days, then expires. A suggestion whose source is deleted goes with it.
- **A thing is proposed once.** A feature that proposes from something people keep editing (posted minutes) proposes each thing in it once, whatever became of the first proposal. To know it has, a decided suggestion keeps a fingerprint of the thing it was made from, never its words.
- **A decided suggestion keeps no text.** Accepting, dismissing or expiring a suggestion deletes what the AI wrote in it (the proposal and its quote). Who decided, when, and what it became stay, as the record. Accepting deletes it once the change is made, so an accept that fails leaves the suggestion waiting as it was. So a suggestion stores AI text only while it waits for a person, which is why it isn't one of the exceptions under [Stored AI text](#stored-ai-text).

> **Added 2026-11-12 (#4309, the drafting session's, Paul's to change).** The 14-day wait, the push going only to the member the run acted for, and deleting a decided suggestion's text were not stated before. Fourteen days covers two weekly meetings, so an officer who misses one review still sees its suggestions at the next.

## Stored AI text

Frapp does not keep the text of prompts or answers, with two exceptions.

| Exception | What is kept | Who reads it | How long |
| --- | --- | --- | --- |
| A member reports an answer, a draft, a suggested task or a summary | That one exchange, shown to the member before they confirm | The Frapp team | 30 days, encrypted |
| Beta diagnostics | Questions and answers in Ask, for one chapter | The Frapp team | 14 days, encrypted, with a fixed end date |

- The diagnostics window exists for the beta only, and only on Ask. While it is on, Ask shows a line saying answers are being saved. It never covers meeting features, and it never keeps an answer that drew on chat.
- **How the window turns on (built 2026-11-12, #4315).** The server names one chapter and holds an encryption key; without both, no chapter is offered it. That chapter's president starts it from Chapter settings, AI, through a confirmation that names the end date, and the yes is written to the audit log. The end date is 14 days out and nothing extends it: on that date the window and everything it kept are deleted, and the president can stop it sooner, which deletes the same. An exchange is kept only when the member's Ask panel showed the saved line before the question was sent. A member's kept exchanges are deleted when they leave the chapter, delete their account, or answer No on the AI sheet. How the Frapp team reads what was kept: [`docs/ops/ai-stored-text.md`](../../docs/ops/ai-stored-text.md).
- **How a report works (built 2026-11-12, #4315).** "Report this" sits on every AI-made surface: an Ask answer, a drafted set of minutes, a suggested task, and a channel or thread summary (2026-11-12, #3946). A member picks a reason (wrong or made up, offensive or harmful, shows something it shouldn't, something else), may add a note, and sees what is attached and for how long before they send it. A report keeps the exchange as Frapp had it, never as a client retells it: an answer's question, the passages and live data the model read, what it wrote and what the member was shown; a draft's notes and the draft (or the minutes as they are now, once the draft is in them); a suggestion and its quote; a summary's conversation as the model read it (only messages whose authors said yes), what it wrote and the points the member was shown. Ask and summaries keep nothing to report from, so an answer or a summary carries the exchange sealed so that only the server can open it, and only for the member it was given to, for 7 days; nothing is stored until the member reports. With no encryption key on the server, a report keeps only what was reported, the reason and the note, and the sheet says so, with how long they are kept. A report made after the reporter or a member it quotes deleted their account keeps nothing. The action is offered only to a member who holds `ai:use`, as Ask is, and a draft or suggestion can be reported only by someone who could open it where it is shown (a draft: the minutes' editors with `meetings:record`, while the meetings module is on; a suggestion: while it is pending in their Suggested list). Nobody in the chapter sees reports; how the Frapp team reads them: [`docs/ops/ai-stored-text.md`](../../docs/ops/ai-stored-text.md). Added 2026-11-12 (#4315, the drafting session's, Paul's to change): the reasons, the 7 days to report an answer, and that the reporter's own No on the AI sheet does not delete their report (a quoted member's does).
- Neither store holds meeting audio or Standards material.
- An officer's notes for drafted minutes are the officer's own input to a feature, not a stored prompt: they are kept beside the unposted minutes so the officer can ask again, with what the officer checks the draft against (what the notes leave out, and each drafted decision and action item beside its line), and are deleted when the minutes are posted ([`meetings.md` § Drafting from notes](meetings.md#drafting-from-notes)). Added 2026-11-12 (#4312, the drafting session's, Paul's to change).
- A stored exchange is deleted when the member who asked or reported deletes their account. It is also deleted early when a member it quotes deletes their account or turns their choice off. (2026-11-12: the diagnostics window quotes no member, because it keeps no answer that had chat in front of the model, so its only early deletions are the asker's.)
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
