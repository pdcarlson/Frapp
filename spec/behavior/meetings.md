# Meetings

Frapp turns a chapter meeting into minutes and suggested tasks, as a paid-tier feature. The minutes come from an officer's notes, from an uploaded recording, or from a recording made in the app. Posted minutes and transcripts land in the [AI corpus](ai.md), giving the chapter searchable institutional memory of what was discussed and decided.

The order the three ways are built in, and why, is [ADR-28](../architecture/adr/adr-28.md) decision 6.

## Meeting type metadata

When an officer starts minutes, by any of the three ways under [Workflow](#workflow), they select a **meeting type**. Standards is in the table because it is a kind of meeting a chapter holds, and it is the one type none of the three ways offers ([Standards meetings](#standards-meetings)).

| Type        | Example                                          |
| ----------- | ------------------------------------------------ |
| Chapter     | Full chapter meeting (most common).              |
| Exec        | Officer / exec board meeting.                    |
| Committee   | Committee or working-group meeting.              |
| Standards   | Standards board / member-conduct hearing.        |
| Other       | Anything else (free-form label optional).        |

The type is captured as metadata on the meeting and persists through transcription. It is **not** a separate template; rather, the AI summarizer uses it to vary tone and emphasis:

- **Chapter**: balanced minutes — attendance, announcements, decisions, action items.
- **Exec**: decisions and action items emphasized; lower-priority on the full discussion log.
- **Committee**: focus on action items and follow-ups; lighter on attendance.
- **Standards**: never drafted. Its minutes are written by hand, and nothing about it is recorded or sent to a model. See [Standards meetings](#standards-meetings).
- **Other**: balanced minutes (defaults to Chapter behavior).

## Template

All meeting summaries use a **single global template** with toggleable sections per chapter. Available sections:

- Attendees (default ON)
- Summary / Overview (default ON)
- Announcements (default ON)
- Decisions (default ON)
- Action items with owner + due date (default ON)
- Discussion log (default OFF — verbose)
- Old business (default OFF)
- New business (default OFF)
- Officer reports (default OFF)

Chapters toggle sections from chapter settings ([`settings/README.md`](settings/README.md)), on the Meetings page's Rules. The template is the same across all meeting types — type only affects AI summarization behavior. The sections always show in the order above. A section switched off keeps what minutes already wrote in it, and those minutes still show it.

> **Added 2026-11-12 (#4312).** Announcements joined the list: the Chapter type's minutes above name announcements, and there was no section to hold them. The list and its defaults are `MEETING_SECTIONS` in `@repo/validation`.

Per-meeting-type template variants are deferred to v2+ pending real usage signal that chapters want them.

## Workflow

There are three ways to start, and they end in the same review screen.

| Way in | What the officer does | Needs |
| --- | --- | --- |
| Notes | Types, pastes or dictates rough notes after the meeting. | Nothing new, which is why it is built first. |
| Uploaded recording | Uploads an audio file on web, for example a phone's voice memo. Built 2026-11-12: [Uploading a recording](#uploading-a-recording). | A transcription provider. |
| In-app recorder | Records on the phone during the meeting. | A new store build, because the app ships without microphone access today. |

1. An officer with the meeting permission starts minutes, selects the meeting type, and links the meeting's event. The event's check-ins fill the Attendees section without any AI. A meeting with no event gets one when minutes are started, with the audience the officer picks, because the event is what says who the minutes are for ([Who can read minutes](#who-can-read-minutes)).
2. For a recording, the audio is transcribed on the server by a transcription provider behind Frapp's own interface. The vendor is chosen by a bake-off on a real meeting ([#712](https://github.com/pdcarlson/Frapp/issues/712)). Transcription is its own step: a general model is not asked to listen.
3. The summarizer drafts the templated minutes from the notes or the transcript, using the meeting type as context. It is given the roster's names, who holds each role, and who checked in, so "the treasurer will send the invoice" resolves to a person.
4. The officer reviews and edits the draft before posting. With a recording, each drafted line links to its moment in the audio, so checking a line takes seconds.
5. The same screen lists suggested tasks, under the rules in [Suggested tasks](#suggested-tasks).
6. On post, the minutes are saved to the meeting and its audience is notified. The officer can also drop a link to them in a channel. The link opens only for the audience, and the minutes' text is never copied into a chat message: a chat message is read by everyone in its channel, and is a chat source for AI under the channel's rules, not the meeting's.
7. Posted minutes, and the transcript when there is one, are indexed for AI Q&A (see [`ai.md`](ai.md)). An answer draws on them only for a member in the meeting's audience; a `chapter_id` match alone is not enough.

> **Changed 2026-11-11 (Paul, [ADR-28](../architecture/adr/adr-28.md) decisions 6 and 7).** This section used to describe one path: record, transcribe "via a Whisper-equivalent service", summarize. It also posted Standards summaries to the vault and indexed every transcript, which contradicted the vault's exclusion from AI ([#3295](https://github.com/pdcarlson/Frapp/issues/3295)). Notes come first because they need no recording and no new app build. Step 6 used to post Chapter, Exec and Committee minutes into one `#meetings` channel, which made an Exec meeting's minutes readable by every member who could open it, and through AI by anyone. They now belong to the meeting and its audience ([Who can read minutes](#who-can-read-minutes)). That audience rule is the drafting session's answer to #3295's access question, built on the event rule that already existed, and is Paul's to change.

## Who can read minutes

A meeting's **audience** is the members its event invites, by the event's own rule ([`events.md` § Event Creation](events.md#event-creation), "Attendance by role"): a member whose answer is "not invited" can't find the event, and can't read its minutes or its transcript. A member who holds `events:update` sees every event, and so every meeting's minutes.

- Minutes and a transcript are readable by the audience, in the app and through AI alike. There is no second, wider rule for AI.
- An Exec meeting is an event that invites the exec roles. Its minutes are then exec-only without any setting on the minutes themselves.
- Changing who the event invites changes who can read the minutes, from that moment.
- **A draft is its author's.** Until minutes are posted, only the officer who started them and holders of `meetings:edit` can read them. Posting is what shows them to the audience. The author is held to the event's audience like anyone else: an author the event no longer shows itself to can't read, change, post or delete the minutes until it does.
- **Minutes outlive their event.** Deleting an event keeps its minutes, which then have no audience: only holders of `meetings:edit` can read them, and they still say the event's name and date. Removing them takes `meetings:delete`.

### Where minutes live

Settled 2026-11-12 with the meetings schema (#4312, [#3290](https://github.com/pdcarlson/Frapp/issues/3290)'s storage question). Minutes are their own record (`meetings`), at most one per event, not the event's notes field. The notes field stays the event's own notes ([`events.md` § Event Creation](events.md#event-creation)): while the meetings module is on, the event sheet labels it "Notes" and shows the event's minutes beside it. Starting minutes copies the event's notes into the Summary once, so nothing typed there is typed twice; after that the two are separate. A chapter with the module off keeps using the notes field as before.

## Writing minutes by hand

The Notes way in, without the AI draft: an officer writes the minutes themselves. The AI draft ([ADR-28](../architecture/adr/adr-28.md) decision 6) fills the same sections later, and the officer reviews it on the same page.

- **Start from the event.** The event sheet's Minutes row offers Write minutes to a holder of `meetings:record`, which starts them in one tap with the type the event's name suggests ("Exec meeting" opens on Exec), and Open minutes to anyone who can read them. The Meetings page's New minutes lists the last month of events, newest first.
- **A meeting that isn't on the calendar** gets an event when its minutes start, by an officer who also holds `events:create`: its name, date and times, and who reads the minutes (everyone, or only some roles). That event requires nobody, earns no points and sends no new-event push, so writing up a meeting after the fact never pings the chapter or changes anyone's attendance record.
- **Writing.** The minutes page is the document and its editor, as a shared doc is: the author's draft opens ready to type, and posted minutes open to read with Edit for whoever may change them. Attendees come from the event's check-ins (present, late, excused) and aren't typed. A decision may carry a vote count (for, against, abstaining), only when the meeting took one. An action item names someone only when the meeting did, and takes a due date. Empty decision and action rows are dropped on save.
- **Two people editing.** A save carries the version it was made on. If someone saved since, the save is refused, the officer's typing stays on screen, and the page offers to load the other version. Nothing is overwritten silently.
- **Posting** asks first, then shows the minutes to the audience and tells each member of it once, except the officer who posted: "Minutes posted", "The minutes from {event} are up." in the `events` notification category. Posting again tells nobody, and edits after posting tell nobody.
- **Who changes them.** The author edits their own minutes, draft or posted, while the event still shows itself to them; a holder of `meetings:edit` edits anyone's. The author deletes their own unposted draft; a holder of `meetings:delete` deletes any minutes.
- **Off by default during the beta.** The `meetings` module is in `BETA_OFF_MODULES`, so no chapter sees Meetings in the nav or its settings page, and every write is refused, until it is taken out of that list.

## Drafting from notes

The officer who takes the minutes pastes or types what they wrote down during the meeting and asks for a draft ([ADR-28](../architecture/adr/adr-28.md) decision 6). The draft lands in the same sections as hand-written minutes, for them to fix and post. Web first (#4312); mobile and the recording path reuse the same draft.

- **Where it is.** A "Your notes" box sits above the sections of a draft the officer may edit. It shows only to a holder of `meetings:record`, when the server has AI on and the president has turned meeting notes on ([`ai.md` § Consent](ai.md#consent)). An officer who has not answered the AI sheet sees the box with one plain line saying so, and can't ask until they have.
- **Asking** needs the right to edit these minutes as well. Typing in the sections is saved first. If the sections already hold something, the page asks before the draft replaces them. Attendees are never touched.
- **While it is written,** the sections wait and can't be typed in, Save and Post wait, and the box offers Stop. Stopping keeps the notes, in the box and stored, and nothing is put into the minutes.
- **It never overwrites a save.** The draft goes into the minutes only if they are still at the version it was asked on. If someone saved meanwhile, the draft waits and the officer chooses Use the draft, which asks before replacing what is written and goes onto the newest version by the same rule. While a draft is being put in, the page never shows it as waiting.
- **Only what the notes say.** Every decision and action item must come with the line of the notes it was drawn from, word for word: one line, never two joined, and enough of it to be that line (a single word or number backs nothing). An item whose line isn't in the notes is dropped, and the officer is told how many were. A vote count is kept only when its numbers are in that line. An owner is kept only when that line names exactly one member, by name or by a role only one member holds; a line that names two members names no owner. Otherwise the item shows "Nobody named". A due date is kept only when that line says when (a number, a weekday, "tomorrow"). An award of points ("give Jake 50 points") is never an action item, and isn't counted as dropped.
- **Honest gaps.** What the notes leave unsaid is listed under "To fill in" (who is doing something, a vote with no count), not guessed. Each drafted decision and action item shows the line it came from until the officer rewrites it.
- **Notes are text, not instructions.** A line in the notes addressed to the AI is not followed.
- **Nothing is posted.** The draft is an unposted draft like any other. Posting is the officer's own step, and action items stay as written for the officer; turning them into suggested tasks is [Suggested tasks](#suggested-tasks).
- **When it can't be done,** the box says why in plain words and keeps the notes: the chapter's AI limit was reached, drafting is unavailable, the provider declined, or the draft didn't come through and can be asked for again.
- **Standards.** A Standards meeting has no minutes in Frapp, so there is nothing to draft into. Minutes whose type is changed to Standards are refused by the server before any text leaves ([Standards meetings](#standards-meetings)).
- **How long the notes are kept.** The notes are kept only while the minutes are an unposted draft, so "Draft again" works and the box is as the officer left it. With them is what the officer checks the draft against: the "To fill in" list, and each drafted decision and action item beside the line it came from. The drafted sections themselves are kept apart from the minutes only while a draft waits to be used. They are deleted when the minutes are posted or deleted, when the officer clears them, when the officer deletes their account, and 30 days after the draft was asked for whatever else happened.

> **Added 2026-11-12 (#4312, the drafting session's, Paul's to change).** Keeping the notes and the check list while the minutes are a draft (which [ADR-28](../architecture/adr/adr-28.md) decision 8 did not foresee, and is noted there), the 30-day limit, and replacing the sections rather than merging into them were not stated before. The conservative choice in each case: the shortest keep that still lets the officer ask again, and a replace the page asks about first.

## Uploading a recording

The officer who recorded the meeting on their phone uploads the file on web and comes back to a transcript in "Your notes", ready for [Drafting from notes](#drafting-from-notes) ([ADR-28](../architecture/adr/adr-28.md) decisions 1 and 7). Built 2026-11-12 ([#712](https://github.com/pdcarlson/Frapp/issues/712)); web only, off unless the server has AI on, a transcription provider is set up and the president has turned meeting notes on.

- **Where it is.** One row at the top of the "Your notes" box, for the same officers who see the box. It always says what the recording is doing and offers the one thing to do about it.
- **Before anything is sent,** the upload step shows the [Recording notice](#recording-notice): the script that should have been read out, what happens to the file, and the Standards rule. The officer picks the file and ticks "Everyone in the room was told this meeting was being recorded, and nobody objected." The server refuses an upload without that tick, and keeps when it was given.
- **What it takes.** M4A, MP3, WAV, AAC, OGG or FLAC, up to 200 MB and 2 hours, and at least 10 seconds: what a phone's recorder makes of a chapter meeting. A provider with tighter limits narrows them, and the step says the real ones. The file is checked the moment it is picked, so a wrong file never starts uploading.
- **The upload is resumable** and goes straight from the browser to a private bucket (`meeting-audio`), signed for that one file. A dropped connection picks up where it left off. The row shows the percent sent and asks the officer to keep the page open; closing it loses the upload, and the row then says it was interrupted.
- **Transcribing takes minutes and needs nobody watching.** It is an AI run (`meeting_transcription`), so the row survives a reload or a closed tab, and Stop removes the recording. The provider is given the roster's names so it spells them right, and nothing else about the chapter.
- **The transcript lands in the notes.** One line per speaker turn, opened by "Speaker 1", "Speaker 2" in the order each voice is first heard ([Voices](#voices)). Empty notes are filled; notes the officer already typed are never written over, and the row offers "Add to your notes" to put the transcript below them. From there it is notes: the officer fixes names, and asks for a draft.
- **The audio is deleted as soon as it has been used:** when the transcript is written, when the transcription fails for good, when the officer removes or replaces the recording, and by a sweep every half hour for anything those missed (an upload nobody finished within six hours, a meeting posted or deleted mid-transcription). A provider that keeps a copy is told to delete it once the transcript is read.
- **The members who were at the meeting are told,** once per meeting, when transcription starts: a notification saying a recording was uploaded to write the minutes, that it is deleted once transcribed, and to tell the secretary if they object. "Who was there" is the event's check-ins; with no check-ins it is the members the event invites.
- **When it can't be done,** the row says why in plain words and what to do next: the file couldn't be read as audio, no speech was heard, it is too long, the chapter's AI limit was reached, or the transcript didn't come through. In every case the audio is already deleted.
- **Standards.** A recording can't be uploaded for a Standards meeting, by the same server check as a draft, made before the upload is signed and again before the audio is sent to the provider ([Standards meetings](#standards-meetings)).
- **What it costs** is the recording's length at the provider's price per hour, held against the chapter's and the member's AI caps before the provider is called and settled at the length the provider measured ([`billing.md`](billing.md)).
- **How long the transcript is kept.** By the notes' rule: only while the minutes are an unposted draft, removed when they are posted or deleted, when the officer clears their notes, when the uploader deletes their account, and after 30 days at most. Neither the audio, its link, the file's name nor the transcript is ever written to a log, an error report or an analytics event.

> **Added 2026-11-12 (#712, the build session's, Paul's to change).** Four things here were not decided before and took the conservative choice. (1) The audio is deleted when the transcript is written, not when the minutes are posted as [Retention](#retention) used to say: nothing built plays it back, so keeping it would hold a recording of a room for no use. Linking each drafted line to its moment in the audio (Workflow step 4) is therefore not built, and would need the audio kept. (2) The transcript is treated as the officer's notes, kept only while the minutes are a draft, and is not indexed for AI Q&A (Workflow step 7 is not built for transcripts). (3) The provider is AssemblyAI in the model catalog, because it is the only candidate that takes a whole meeting with speaker labels in one request; Google's transcription model is built as the challenger and caps a request at 30 minutes. The vendor is still Paul's pick after a bake-off on a real meeting, and no key exists yet. (4) Whether the tick and the notification are enough in a state that requires everyone's agreement is counsel's question ([#3297](https://github.com/pdcarlson/Frapp/issues/3297)); the wording is working copy. The notes box's limit rose from 40,000 to 160,000 characters so a two-hour transcript fits.

## Suggested tasks

Minutes produce suggested tasks, as [`ai.md` § Suggestions](ai.md#suggestions) describes for every proposal.

- **The officer creates them, not the AI.** The review screen lists each suggested task with its title, owner, due date and the line it came from. The officer unticks, edits, and confirms. Tasks are then created under that officer's own permission.
- **An owner only when one was named.** A task gets an owner only when a name or a role was said or written for it. Otherwise it shows "Who?" with a member picker. A wrong owner is worse than a blank one.
- **Two members with the same first name are the officer's pick,** never a guess.
- **A suggested task never carries points.** "Give Jake 50 points" spoken in a meeting is not an instruction. The officer adds points by hand.

## Standards meetings

A Standards meeting (a standards board or member-conduct hearing) is never recorded, never transcribed and never sent to a model.

- **None of the three ways offers the type.** Notes are covered as much as recordings: an officer can't paste hearing notes into the drafter and pick Standards.
- **The server refuses it too.** A request to draft minutes for a meeting typed Standards is rejected before any text is sent anywhere. The check does not live only in the app. Hand-written minutes can't be typed Standards either: `POST /v1/meetings` answers 400 `meeting.standards_refused`, and the table's own check refuses the type.
- **An officer writes Standards minutes by hand,** and they are stored in the [vault](vault.md), which the AI never reads. Until the vault exists they are kept outside Frapp.
- **Filing a hearing under another type to get a draft breaks this rule,** and the product can't detect it. The notes screen says so in one line where the type is picked, as the hand-written minutes' type picker already does.

## Recording notice

A meeting is recorded only after the room has been told.

- **The officer reads a short script aloud before recording starts,** for example: "This meeting is being recorded and transcribed by Frapp. Tell the secretary if you object."
- **Frapp posts a notice to the meeting's attendees.** For an uploaded recording that is a notification when the upload finishes, and the officer confirms in the upload step that the script was read ([Uploading a recording](#uploading-a-recording)).
- **The recording phone shows a visible indicator for as long as it records.**
- **Anyone present may object, and the officer then doesn't record, or pauses.**

Apple requires explicit consent and a visible indication for any recording (App Review Guideline 2.5.14). Several states require every person present to agree, so a chapter in one of them should confirm the script with counsel first.

## Voices

Frapp stores no voiceprint and never recognises a member by voice. Speaker labels belong to one meeting ("Speaker 2"), and an officer maps a label to a name by hand. Nothing about a voice is kept or reused across meetings.

## Permissions

- Starting minutes, by notes, upload or recording, requires the `meetings:record` permission. Default seeds: President, Secretary, exec roles. It is on the Exec board tier, so every role in the chapter's top tier holds it ([`rbac.md`](rbac.md)).
- Editing someone else's minutes requires `meetings:edit` (default: President). The officer who started them always edits their own.
- Deleting minutes requires `meetings:delete` (default: President only). The officer who started them may delete their own unposted draft.
- Reading needs no meetings permission: the audience rule above decides it.

## Retention

- **Raw audio is deleted as soon as its transcript is written,** or its transcription has failed for good ([Uploading a recording](#uploading-a-recording)). Audio can't be anonymised when a member deletes their account, so it must already be gone.
  - Changed in #712 by the build session, 2026-11-12, pending Paul: this line used to read "deleted when the minutes are posted. A recording whose minutes are never posted is deleted after 30 days."
- **A recording's transcript** is kept as the officer's notes are: only while the minutes are unposted, and never more than 30 days.
- **Transcripts and posted minutes** follow the chapter's general [data retention](data-retention.md) policy. When a member deletes their account, their name on a speaker label becomes "Deleted User", as it does on their chat messages.
- **An officer's notes for a draft** are kept only while the minutes are unposted, and never more than 30 days ([Drafting from notes](#drafting-from-notes)).
- **Standards minutes** in the vault follow the vault retention rules.
