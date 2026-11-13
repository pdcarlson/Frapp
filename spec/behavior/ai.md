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
- **Background work acts for a named member.** Drafting minutes acts for the officer who started it. A scheduled feature acts for the officer who turned it on or who will receive its result. The run reads only what that member can open at the moment it runs (one exception, which shows nobody anything: [This time last year](#this-time-last-year) reads this year's whole record to decide what to stay quiet about). A run with no member to act for does not read the corpus.
- **What a run produces is shown only to people who could open its sources.** A suggestion drawn from an Exec meeting or a role-gated channel is listed only for officers who can open that meeting or channel.
- **So is the fact that a run exists.** The member who started a run and the member it acts for can follow its progress ("Drafting minutes") and see how it ended. Anyone else sees it only when they could open what it reads, and otherwise gets the same answer as for a run that does not exist.
  - Indexing the chapter's sources for search is the chapter's upkeep: nobody asked for it, and it acts for whoever last changed a source, or the president. It is not that member's run, so it is not listed for them, and its cost is not charged to their daily allowance ([`billing.md` § Caps](billing.md#caps), #4504).
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
- **One conversation.** Ask is a thread: every turn stays on screen, and a follow-up can lean on what came before ([One conversation](#one-conversation)). Changed in #4699 by pdcarlson, 2026-11-13: until then each question was answered on its own and the panel said so under the field.
- **How an answer is made.** The question searches the chapter's index as the asker ([Corpus scope](#corpus-scope)), and in parallel a small planning call picks which live-data tools the question needs from the ones this member may use. The tools run as the asker. One writing call then sees the tool results, the official passages and the chat passages, in that order, and must quote the source for each claim.
- **Live data is read through tools, never the index:** the roster (names and roles, no contact details), upcoming events, the asker's own points and the leaderboard, the asker's own dues, and the asker's own unfinished tasks (added in #4700 by pdcarlson, 2026-11-13: what is assigned to them, when each is due, and whether it is past due, sent back or waiting on an officer; an officer asking gets their own tasks, not the chapter's). Each tool mirrors a route, needs that route's permission and module, and only reads. A tool that would change something is never offered to the call that answers; a member who may have Frapp act gets a card to confirm instead, worked out apart from the answer ([Asking Frapp to do something](#asking-frapp-to-do-something)). Attendance and "who is behind on dues" have no tool yet.
- **No answer without a source.** The server checks every quote against its source ([Citation requirement](#citation-requirement)). An answer left with no checked citation is not shown: the member reads "I couldn't find that in your chapter's documents, minutes or records." When some quotes were dropped and others stood, the answer says part of it could not be matched.
- **What streams is a preview.** Text appears as it is written, over one line that says what Frapp is doing. The server decides what stands after the model stops, and the checked answer replaces the preview.
- **The line under a working turn says what the server is really doing** (changed in #4701 by pdcarlson, 2026-11-13: until then it was one of three fixed lines, "Searching your chapter's sources", "Reading what it found" and "Writing", whatever was read, and a turn that ended in a card said "Searching" until the card arrived). Each line is sent when that work starts, and none is shown for work that did not happen:
  - "Searching your chapter's sources" from the start: the index is searched and the question is read for which live records it needs.
  - "Reading the events calendar and 3 sources" once that is back: the live records picked for this question, by name (the roster, the events calendar, your points, the points standings, your dues, your tasks), then how many sources the search found, each document, set of minutes or conversation counted once. A turn with nothing found and no record picked never says it is reading. A chat source can still be left out after it is counted, when its author has said No since ([Consent](#consent)).
  - "Writing" at the first word of the answer, not before.
  - "Working out what that would change" when the member's words have been read as something Frapp can do for them and the card's details are being looked up ([Asking Frapp to do something](#asking-frapp-to-do-something)). If no card can be made after all, the answer's own lines follow.

  The line sits where the sources go when the answer lands, so nothing above it moves. The words are one function in `@repo/validation` (`askStepLine`), read by web and the phone. A build that does not know a step shows the searching line; one that does not know a record's name leaves it out.
- **Sources open.** Each cited sentence carries a numbered marker, and each source is a chip under the answer with the same number and its name; its kind, place and full date are the chip's tooltip on web and its spoken name on both (changed in #4699 by pdcarlson, 2026-11-13: they were rows that spelled the kind and date out, which made a thread of several answers long). A document opens in the viewer, minutes open the meeting, a channel message opens in its channel, and live data opens its page. Live data has no date; it says "Read just now".
- **Left-out messages are counted, never named.** When the channels an answer drew on hold messages from members who have not agreed, the answer says how many were not included.
- **When it can't answer** it says which: the member has not answered the AI sheet (with a button that opens it), the president turned Ask off, the chapter or the member reached its allowance, or Ask is not available. A provider refusal reads "Ask can't help with that question."
- **The stream format is versioned and defined once,** in `@repo/validation` (`ask.ts`), for the API that writes it and for web and mobile that read it. A reader ignores an event type, a key or a source kind it does not know, so an installed mobile build keeps working when the format grows.
- **Limits.** A question is at most 1,000 characters. Ten questions a minute per member, on top of the spend caps.

> **Added 2026-11-12 (#450, the building session's, Paul's to change).** Not stated before: single questions with no follow-ups; the pill hidden rather than disabled when the president has Ask off; no relevance threshold (the no-source rule is the only "couldn't find it" test); an event's location text is given to the model; and the rate of ten a minute.

### What Ask opens with

Decided 2026-11-13 by Paul (the opening suggestions must come from the member's own account, "not just be like some presets"; suggested follow-ups after an answer are left out for now), built in #4700 on web and the phone. Until then the empty panel offered three fixed questions and, for an officer, one fixed request.

- **Built from the member's own account, with no model call.** When Ask opens, the server reads what this member's account holds right now and returns at most three questions and at most one request (`GET /v1/ai/ask/suggestions`). Nothing is sent to a provider, so it does not need the member's yes on the AI sheet; the sheet is still asked at the first question.
- **The questions, in the order they are kept when there are more than three:** what the member owes on their soonest unpaid invoice (while Dues is on); their one open task by name, or "Which of my 3 open tasks is due first?" for several; when and where their next event is, with its day said the way a member would ("today", "tomorrow", "on Sunday", "on November 22"), so a meeting that repeats is asked about on the right day (one they must attend in the next seven days, before a sooner one that is optional for them; otherwise the next one they are invited to, within two weeks); what was decided at the most recent meeting whose posted minutes they can read (within 60 days); and how many points they have this semester (only once their points have moved this semester).
- **Frapp can answer every one it offers.** A question is offered only when the live-data tool that answers it is one this member would be offered for a typed question (the same permission and module check), and the minutes question only for minutes that are in the search index now.
- **No fixed list.** A member with nothing to ask about (a new member in a quiet chapter) sees the two opening lines and the field. Nothing stands in.
- **The one request** is offered to a member who can have Frapp make a task, for the event they are asked about when it is two to six days away, and otherwise for the first coming event they are invited to that is: "Make a task for me to get ready for Sunday's event, due Saturday". It names the two weekdays and nothing else from the event.
- **A tapped question is not the member's own words.** It can name an event, a task or an invoice, and a name is text another member wrote. So it is sent as an answer-only turn, and it is never among the earlier messages read when working out whether later words ask for something to be done ([`ai-prompt-injection.md`](../../docs/security/ai-prompt-injection.md) § The acting agent). A name is put on one line (line breaks become spaces), and one longer than 60 characters is not offered. The answer itself does read the tapped question, name included; it can change nothing, and the security doc says what bounds it. The request holds no name, so it is sent like typed words and comes back as a card.
- **They arrive without moving anything.** The list fades in under the opening lines, where nothing sits below it. A read that fails drops its own suggestion, never the opening.
- **A list on screen never changes.** It is read when Ask opens and not again while Ask is open. Reopened within a minute, it is the same list. Reopened later, it is read again and the rows are absent until the new list arrives, so one row is never swapped for another under a thumb.
- **Same list, same words, on web and the phone:** the server builds it and `@repo/validation` (`askSuggestionText`) words it.

### One conversation

Decided 2026-11-13 by Paul (no Ask and Do tabs, and "all proposed cards show up as proposed cards and can be acted on as such"; "Just don't tell them that" of the line saying each question was answered on its own), built in #4699 on web and the phone.

- **One field.** A question and a request are typed in the same field. There are no Ask and Do sides. Frapp works out which it is: a member who may have Frapp act gets a card to confirm when what they typed asks for something it can do, and an answer otherwise. Everyone else gets answers only, from the same field.
- **Every turn stays.** What the member typed sits in a bubble on the right, and what Frapp came back with is plain text on the left, or a card. A card is not replaced by the next thing asked: each stays live until it is confirmed or cancelled, and then reads as one line saying what happened. A card that stopped waiting some other way (a day passed, or it was decided on another device) still shows its buttons until Confirm or Cancel is pressed; that press finds it gone and the card becomes one line, "This is no longer waiting. Ask again.".
- **A follow-up leans on what came before.** "And for elections?" after a question about quorum is answered as a question about quorum for elections. The turns before a question are sent with it, at most the last six: what the member typed, and Frapp's answer to it. A request typed after a card ("make it 10") is read with the member's own earlier messages, so the new card can carry what the first one said.
- **No answer without a source still holds, per question.** Earlier turns are context for reading the new question. They are never a source: every claim in a new answer must quote a source found for this question, and an answer left with no checked citation is still "I couldn't find that".
- **An answer that drew on chat is not sent again.** When channel messages were among the sources an earlier answer was written from, whether or not it cited one, only the member's question from that turn is carried forward, never the answer's text, so words from members' chat are not sent to the provider a second time ([Chat as a source](#chat-as-a-source)). A refusal, a miss and a card carry the question only, too. The question is always kept, so "it" in the next one still has something to point at.
- **The conversation is this sitting's.** It is held on the member's device, survives closing and reopening Ask, and is gone when the page reloads or the app restarts. The server keeps nothing between questions that it did not keep before ([Stored AI text](#stored-ai-text)): keeping conversations on the server waits on consent, privacy and store wording Paul has not approved yet.
- **New conversation** in Ask's header clears the thread. Cards still waiting are not cancelled by it; they expire in a day like any other.
- **A question still being answered when Ask closes is dropped.** The turns before it stay.
- **A request has already been searched for.** Frapp reads what was typed as a question and as a request at the same moment, so a question waits on nothing. When it turns out to be a request, the search has already run and is thrown away: nothing it found is shown, no live data is read and no answer is written.
- **One route.** `POST /v1/ai/ask` takes the question, the earlier turns (`history`) and whether this screen shows cards (`actions`, sent for any member who holds `ai:act`, except on a question tapped from the opening suggestions). `POST /v1/ai/act` stays for app builds shipped before this, which still show two sides.

## Catch me up

A member back to a busy channel asks for the short version and gets a few lines, each tied to the message it came from. Built 2026-11-12 on web (#3946) and on the phone (#3946, the mobile half, 2026-11-12). It is off unless the server has `AI_ENABLED` on and the chapter's president has turned on both Ask and "Include channel messages", and it needs the member's yes on the AI sheet.

- **Only when a member asks.** Nothing summarizes in the background, on a schedule, or for a channel nobody asked about. One request is one summary for one reader.
- **Chapter channels only.** Never a direct message, a group DM or the audit log. The reader must be able to open the channel, by the timeline's own check.
- **What it reads.** One of three stretches: the messages that were new when the member opened the channel, the channel's last 24 hours or 7 days, or one thread (a thread under a card or a deleted message is its replies; never one under a recruitment candidate's card, which stays out with the rest of rush, Paul 2026-11-12, #4504). At most the newest 300 messages, no further back than 30 days, and about 48,000 characters of text; when a stretch is longer, the summary says it read the most recent part.
- **Consent is [Chat as a source](#chat-as-a-source)'s, unchanged.** Only messages whose authors said yes are sent. Everyone else's are left out and the summary says how many, never whose. An imported message nobody linked to a member is left out the same way. A member the reader blocked is left out and not counted, so the count cannot say who.
- **Too little is not summarized.** A stretch with fewer than 5 readable messages is quicker to read than to shorten, so no model is called and the member is told so. When consent is why, it says that.
- **Every line is tied to a message.** A summary is up to 12 points in four groups, shown in this order: For you (asked of the reader, assigned to them, or promised by them), Decided, Dates and reminders, Also discussed. The model must name the one message each point rests on and quote words from it. The server checks every quote against that message, word for word, and drops a point that fails, or whose quote is under 10 characters when the message is longer. That proves where a line came from, not that its sentence is right: the sentence is the model's, which is why pressing it opens the message. Each message is sent as one line, so a message cannot be written to look like someone else's. A summary left with no point is not shown, and one that lost some says part of it could not be matched. Pressing a line opens its message, in its thread when it is a reply.
- **There is no overall paragraph.** A gist nobody can check is the part of a summary most likely to be wrong, so the points are the summary.
- **It proposes nothing.** A decision or a reminder in a summary is a line, never a suggested task, a calendar entry or a notification. Chat never triggers an action ([Chat as a source](#chat-as-a-source)), and a suggestion made from a private read would outlive it.
- **Only the asker sees it, and it is not kept.** The summary is the response to the request. The server stores no summary, no prompt and no point, the beta diagnostics window never covers it, and the client holds it only while the panel is open: closing the panel, leaving the channel or reloading ends it.
- **Report this is the one way any of it is kept.** A summary that stands carries Report this, as every AI-made surface does ([Stored AI text](#stored-ai-text)). The server seals the exchange into the response and forgets it, as it does for an Ask answer; a report hands it back, and only then is it stored: the messages the model read and the summary, encrypted, for 30 days, for the Frapp team. The report names the members whose messages it holds, so it is deleted early when one of them answers No or deletes their account.
- **A message is never an instruction.** The conversation goes to the model as data, with the instructions in the system channel, and the call has no tools. Contact details are not to be repeated.
- **Where it is.** On web: "Catch me up" in the channel's menu, a "Summarize thread" control on a thread of 5 or more messages, and a strip above the timeline when a channel opens with 20 or more new messages ([`../ui/web-dashboard/README.md` § Chat](../ui/web-dashboard/README.md#chat)). With summaries off for the chapter, or for a member without `ai:use`, none of these appear.
- **On the phone** the summary is a sheet over the channel or the thread ([`../ui/mobile/screens.md`](../ui/mobile/screens.md) s05). The ways in are the same three, placed where a phone has room: a "Catch me up" row in the channel header's ⋯ menu, a "Summarize thread" action on the thread's reply-count line (and a strip under the thread's header at 20 or more replies), and a strip under the channel's header when it opens with 20 or more new messages. The mobile timeline has no unread divider to hang the offer on, so the strip counts from what Chat home held when the channel was opened; a channel opened cold, from a push, offers the last 24 hours from the menu and no strip. A sheet cannot sit beside the message the way web's panel does, so pressing a line closes the sheet and scrolls to the message, and the strip then reads "Your summary is still here." with "Back to summary": the same summary comes back, with no second request. Swiping the sheet away, the strip's ×, or leaving the channel ends it.
- **When it can't** it says which: the member has not answered the AI sheet (with a button that opens it), the president has summaries or channel messages turned off, the chapter or the member reached its allowance, or summaries are not available. A provider refusal reads "This conversation can't be summarized."
- **Limits.** Ten summaries a minute per member, on top of the spend caps. The request, the answer and the words both clients show are defined once, in `@repo/validation` (`chat-catch-up.ts`).

> **Added 2026-11-12 (#3946, the building session's, Paul's to change).** Known limit, flagged in the PR: the left-out count is exact, so a member who asks about a stretch holding one other member's messages can tell from it whether that member said yes. The issue asked for the design to be settled with Paul first; this is the most conservative shape, built so he can change it. Not stated before: points instead of prose, with no overall paragraph; the four groups and their order; no suggestions from a summary; that it rides the Ask switch and the chat switch, with no switch of its own and no new version of the member sheet (the sheet names providers and kinds of data, not features, and messages in channels is already one of its kinds; the "Include channel messages" switch's description now names summaries, so a president knows what it turns on); the reader's blocked members left out uncounted; every number above (5, 12, 20, 300, 30 days, ten a minute); that the author's name goes to the model beside their message, as it does for Ask; and that a reported summary keeps the consenting members' messages it read (the Stored AI text table's first row, applied to summaries).

## Asking Frapp to do something

An officer types what they want done ("give 5 points to everyone who came to chapter tonight", "make a task for Jordan to book the bus by Friday") and gets back a card that says exactly what would happen. Nothing changes until they press Confirm. Built 2026-11-12 on web (#718) and on the phone (#718, the mobile half, 2026-11-12).

- **Who can.** A member who holds `ai:use` and `ai:act` (and `members:view`, as every member does), in a chapter whose president has Ask on, on a server with `AI_ENABLED` on, after their yes on the AI sheet. No starting role holds `ai:act`: a chapter grants it on the Roles page. `ai:act` adds no authority of its own. It lets a member ask for the changes they could already make by hand.
- **Where it is.** In the Ask conversation, in the same field a question goes in ([One conversation](#one-conversation)). Changed in #4699 by pdcarlson, 2026-11-13: until then the panel had two sides, Ask and Do, and a question and a request used separate routes. What kept a question from reaching an action then still does, another way: the call that writes an answer is offered no tool that changes anything, and the call that reads a request is shown only what the member typed. Each turn runs both for a member who can ask for at least one action. A card is shown when the request reading finds an action, or finds one with something left unsaid; otherwise the answer is.
- **On the phone** it is the same thread in the Ask sheet ([`../ui/mobile/screens.md`](../ui/mobile/screens.md) s17), on the same terms. The card says the same things in the same words. Two things differ, both because of the size of the screen. A member is added to a points change from the chapter's roster in a tall sheet with a search field, which is how the phone picks a member everywhere else. A task's who and when are changed in the ordinary New task form opened on the proposal, where web changes them on the card; Confirm on a task missing either opens that form. A finished task or event links to Tasks or Events; a finished points change links nowhere, because the phone has no points page.
- **What it can do** (three actions; each needs the permission and the module of the route it stands in for, and one the member lacks is not offered):
  - **Give or take away points** (`points:adjust`), for members named, for everyone who holds a role, or for everyone who came to an event.
  - **Create a task** for one member (`tasks:manage`).
  - **Put one event on the calendar** (`events:create`), open to the whole chapter. Who is invited by role, a check-in zone and a repeat are set on the event form afterwards.
- **One request, one action.** A request that asks for two things gets a card for one. A later request is read with the member's own earlier messages in the conversation, so "make it 10" can finish what "give Ana 5 points" started; an earlier message the new one does not continue is never acted on again. Changed in #4699 by pdcarlson, 2026-11-13: until then nothing was remembered between requests.
- **The action is chosen from the officer's own words and nothing else.** The model that reads the request is shown the request, the officer's own earlier messages in this conversation, and the list of actions this officer may take. It is not shown Frapp's answers, chat, documents, minutes, the roster or anything retrieved, so nothing another member wrote can pick an action or change one ([`ai-prompt-injection.md`](../../docs/security/ai-prompt-injection.md) C3). An answer naming an action that was not offered is treated as no action.
- **Names are looked up in this chapter's roster by the server.** A full name, a first or last name, or the start of one finds a member. A role's name finds everyone who holds it, and the card says how many. Two members with the same name are never guessed between: the card says so and the officer adds the one they meant. A name the lookup cannot place ("Jake" for Jacob) goes to a second small model call that sees the roster's names and may only answer with one of its lines; the card says which member it was read as, so the officer checks it.
- **"Everyone who came" means marked present or late** at the event, read only for an officer who could open that event's attendance (`events:update`). When the request names the event, or names only a day that had one event, that event is used, and the card names it and its day. An event the officer named is never swapped for another on the same day. Otherwise the officer picks from the events of the last two weeks, and that pick uses no model.
- **The card says its size plainly.** A points change reads "Give 5 points to 42 members", with "210 points in all, in 42 separate changes" under it, the reason, and the members listed. The officer can take a member off or add one before confirming. A task card lets them pick who and when. An event card shows the name, the time written out in full, the place, whether it is required, and the points.
- **An officer cannot change their own points,** so they are left off a points change that would include them, and the card says so.
- **A waiting card is a [suggestion](#suggestions)** only the officer who asked can open. It is not in the Suggested list, sends no push, and is gone after one day. Asking for something else in the conversation leaves it waiting (changed in #4699 by pdcarlson, 2026-11-13: it used to be replaced, as it still is for a request sent to `POST /v1/ai/act` by an app build from before the conversation).
- **Confirm makes the change the ordinary way.** It checks the action's permission again at that moment, then goes through the same service the Points, Tasks and Events pages use, as that officer. A points change is one ledger entry per member under the officer's name, in the Manual category, with the usual push to each member. A task and an event are created by that officer, and the usual pushes go out. No chat card is posted.
- **The hourly points limit holds.** A chapter limits how many point adjustments one officer makes in an hour (50 unless the chapter changed it). A points change for more members than the officer has left this hour is refused whole, before anything is written, and says to take members off or raise the limit. A Confirm that fails part-way (a write that did not land) is not reported as done: the card stays, says how many members got their points, and can be confirmed again. Members already changed are not changed twice, and do not count against the limit a second time.
- **A member who left** between the card and Confirm is left out, and the result says how many were.
- **When it can't,** it says which: something was left out of the request ("Say how many points."), or Ask is unavailable for the same reasons as a question. A request for something that is not one of the three actions is read as a question and answered from the chapter's sources, which usually reads "I couldn't find that" ([#4706](https://github.com/pdcarlson/Frapp/issues/4706)).
- **Limits.** A request is at most 1,000 characters, a points change at most 300 members, and ten turns a minute per member, on top of the spend caps. A turn typed by a member who can have Frapp act costs one more small planning call than a question from anyone else.
- **What is stored and sent.** The request is not stored. The card is stored only while it waits, like any suggestion. Analytics records that a proposal was made and which action, never the request or the card.

> **Added 2026-11-12 (#718, the building session's, Paul's to change).** None of this section was stated before. The choices in it: three actions, and no fines (a formal fine stays a thing an officer does on the Points page); Ask's chapter switch governs Do, with no separate switch; the waiting card is a saved suggestion with a one-day life, which overrides the older note on #1308 that a proposal would not be saved (ADR-28 decision 11 says proposals are suggestions, and there is one suggestions table); the hourly points limit is kept and a larger change is refused whole; an event card is confirmed or cancelled, not edited; and the two model calls use the same model as Ask's planner, which the bake-off has not graded for this task.

## Suggestions

Some features propose instead of answer: a task drafted from minutes, an event the chapter held this time last year, a decision worth logging, a value for a form field.

- **A suggestion is a proposal, and nothing changes until a person accepts it.** Accepting checks that person's permission again, at that moment, and then makes the change the ordinary way.
- **Suggestions are never posted into chat as messages.** They appear where they belong (on the minutes, on the task list) and in one "Suggested" list for officers.
- **One notification per batch.** Ten suggested tasks from one meeting are one push, not ten. It goes to the member the run acted for, and only when they could accept something in it. A weekly feature sends one for the week, however many batches it made ([This time last year](#this-time-last-year)).
- **A suggestion shows why.** It carries the quote or the source it came from. The server checks the quote word for word against that source, as it does a citation, and the quote is shown only to someone who can open the source.
- **Only people who could accept it see it.** The Suggested list and the in-context lists show a suggestion to a member who holds the permission accepting needs, has the feature's module on, and can open its source, all checked when they look. Accepting checks the same three again.
- **Unaccepted suggestions expire.** A suggestion waits 14 days, then expires (one day for a card an officer asked for, [above](#asking-frapp-to-do-something)). A suggestion whose source is deleted goes with it.
- **A thing is proposed once.** A feature that proposes from something people keep editing (posted minutes) proposes each thing in it once, whatever became of the first proposal. To know it has, a decided suggestion keeps a fingerprint of the thing it was made from, never its words.
- **A decided suggestion keeps no text.** Accepting, dismissing or expiring a suggestion deletes what the AI wrote in it (the proposal and its quote). Who decided, when, and what it became stay, as the record. Accepting deletes it once the change is made, so an accept that fails leaves the suggestion waiting as it was. So a suggestion stores AI text only while it waits for a person, which is why it isn't one of the exceptions under [Stored AI text](#stored-ai-text).

> **Added 2026-11-12 (#4309, the drafting session's, Paul's to change).** The 14-day wait, the push going only to the member the run acted for, and deleting a decided suggestion's text were not stated before. Fourteen days covers two weekly meetings, so an officer who misses one review still sees its suggestions at the next.

## This time last year

Officers turn over every year and the chapter's record does not. A president elected in March does not know the chapter ran its philanthropy week every April, and nobody tells them until April. So once a week Frapp compares the coming six weeks with the same six weeks a year ago and raises, as [suggestions](#suggestions), the few things the chapter did then that this year's calendar and task board don't show (#3930).

- **The tone is the feature.** A suggestion says what happened last year, says Frapp doesn't see it this year, and invites correction: "Held on April 13, 2026. I don't see it on this year's calendar." It never says something is missing, never tells an officer what to do, and never repeats itself. The words are shared by web and mobile (`packages/validation/src/last-year.ts`).
- **No model reads anything.** The comparison is dates and titles, done in code, and the line an officer reads is a fixed sentence around last year's own title and date. Nothing leaves Frapp, so the feature asks for no member's Yes, sends nothing to a provider, and counts against no spending limit.
- **It is off unless the chapter's Ask switch is on**, and the server has AI on. Ask is the switch for Frapp reading the chapter's own record on an officer's behalf; there is no switch of its own.
- **It acts for the chapter's President.** Last year's events are read as the president reads them, and last year's tasks only when the president can manage tasks. This year's record is read whole, because it is only ever used to stay quiet: something already planned for a group the president is not in is still planned. A chapter with no president gets nothing.
- **What it compares.** Last year's stretch is today to six weeks on, moved back 52 weeks (not a calendar year, so a Saturday stays a Saturday). From it: events, one suggestion per name however many times it was held (a weekly series is one thing, "held 6 times"), and finished tasks, leaving out a chore (the same title due in three or more different months of the year up to the end of last year's stretch, so the same April over three years is one month). Posted minutes are not compared on their own: what a meeting was is its event, and what it asked for is the tasks its action items became.
- **"On this year's record" is read loosely, on purpose.** Staying quiet about something missing costs the chapter nothing it had before; speaking up about something already planned under another name is the nagging this must never do. So this year's record is read from 60 days before today to 60 days past the six weeks, tasks made in that time count whenever they are due, and titles match without their year, count or term ("Fall Formal 2025" is "Formal") and when one is inside the other ("Philanthropy Week" is seen in a task named "Plan philanthropy week"). When in doubt, it has been seen.
- **A few, once.** A sweep raises at most three new suggestions for a chapter, soonest first whether event or task, and none while five are waiting. A thing is raised once: accepted, dismissed or expired, nothing by that name is raised again for 150 days. So a yearly thing does not come back until next year, a weekly series dismissed in its first week stays gone for the term it runs through, and the formal a chapter holds every term is raised for each. A suggestion still waiting when the thing shows up on this year's record is taken back by the next sweep, and counted as withdrawn.
- **One notice a week at most.** It goes to the president, only when the week raised something new they could act on, titled "This time last year". Category `events` or `tasks`, by the first thing in it.
- **An event is added by the officer, in the ordinary form.** "Add to calendar" opens the event form filled in as a copy of last year's event, moved 52 weeks on (same weekday, same time of day; a week further at a time if that day has already passed), never repeating, with the year in its name carried forward ("Winter Formal 2025" opens as "Winter Formal 2026"). Nothing is made until the officer saves it, by the ordinary route with its ordinary checks; the suggestion then records the event it became. Only the member who made the event can record it against the suggestion; anyone else's event answers as one that does not exist. Recording it is not counted as a change to the suggestion (`edited` stays false).
- **A task is accepted like any suggested task.** It carries last year's title, description and checklist, is due 52 weeks after last year's, and names nobody: the officer who did it last year has likely handed the job on, so the officer accepting picks who.
- **"Already planned" is one tap**, on the row, beside the ways to accept it. It dismisses the suggestion; so does "Not this year" on an event. Why is never stored: only that it was dismissed.
- **Where it is on the phone.** One list, titled "Suggested" ([`../ui/mobile/screens.md`](../ui/mobile/screens.md), Suggested), holds the tasks from posted minutes and, under a "This time last year" heading, last year's events and tasks. The "This time last year" notice opens it, and Events and Tasks each show one row leading to it while something is waiting. "Add to calendar" opens the phone's ordinary New event form on the same template web builds.
- **Who sees one.** As for any suggestion: an officer who could accept it (create events, or manage tasks), with the module on, who can open last year's event or task. A task's suggestion can be opened by anyone who manages tasks, else by the member last year's task was assigned to.
- **Under a year of history, nothing, silently.** A chapter younger than about 46 weeks is not looked at, and an older one with nothing in last year's stretch gets no message saying so. Chat is never read, so a Discord import adds no history here.

> **Added 2026-11-12 (#3930, the building session's, Paul's to change).** Paul's ask set the tone and the limits in kind ("a few", "one per thing per year", "dismiss means gone", "already doing it is one tap"). The numbers are this session's: six weeks ahead, 52 weeks back, 60 days of slack, three new a week, five waiting, 150 days before a name is raised again, three months for a chore, Ask as the switch, the president as the member it acts for, and no model call. The no-model choice leaves out what only a model could compare: the free-text action items and decisions of last year's minutes that never became tasks (#4416).

## Stored AI text

Frapp does not keep the text of prompts or answers, with two exceptions.

| Exception | What is kept | Who reads it | How long |
| --- | --- | --- | --- |
| A member reports an answer, a draft, a suggested task or a summary | That one exchange, shown to the member before they confirm | The Frapp team | 30 days, encrypted |
| Beta diagnostics | Questions and answers in Ask, for one chapter | The Frapp team | 14 days, encrypted, with a fixed end date |

- The diagnostics window exists for the beta only, and only on Ask. While it is on, Ask shows a line saying answers are being saved. It never covers meeting features, and it never keeps an answer that drew on chat.
- **How the window turns on (built 2026-11-12, #4315).** The server names one chapter and holds an encryption key; without both, no chapter is offered it. That chapter's president starts it from Chapter settings, AI, through a confirmation that names the end date, and the yes is written to the audit log. The end date is 14 days out and nothing extends it: on that date the window and everything it kept are deleted, and the president can stop it sooner, which deletes the same. The server takes that stop even with AI turned off (#4504); the apps hide the AI settings while it is off, so the 14-day sweep, which also runs either way, is what ends a window then unless someone stops it through the API. An exchange is kept only when the member's Ask panel showed the saved line before the question was sent. A member's kept exchanges are deleted when they leave the chapter, delete their account, or answer No on the AI sheet. How the Frapp team reads what was kept: [`docs/ops/ai-stored-text.md`](../../docs/ops/ai-stored-text.md).
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
