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
- Decisions (default ON)
- Action items with owner + due date (default ON)
- Discussion log (default OFF — verbose)
- Old business (default OFF)
- New business (default OFF)
- Officer reports (default OFF)

Chapters toggle sections from chapter settings ([`settings/README.md`](settings/README.md)). The template is the same across all meeting types — type only affects AI summarization behavior.

Per-meeting-type template variants are deferred to v2+ pending real usage signal that chapters want them.

## Workflow

There are three ways to start, and they end in the same review screen.

| Way in | What the officer does | Needs |
| --- | --- | --- |
| Notes | Types, pastes or dictates rough notes after the meeting. | Nothing new, which is why it is built first. |
| Uploaded recording | Uploads an audio file on web, for example a phone's voice memo. | A transcription provider. |
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
- An event already has a notes field that officers use for minutes ([`events.md` § Event Creation](events.md#event-creation), "Meeting minutes"). Drafted minutes must not become a second place for the same meeting's minutes. How the two are stored is settled with the meetings schema ([#3290](https://github.com/pdcarlson/Frapp/issues/3290)).

## Suggested tasks

Minutes produce suggested tasks, as [`ai.md` § Suggestions](ai.md#suggestions) describes for every proposal.

- **The officer creates them, not the AI.** The review screen lists each suggested task with its title, owner, due date and the line it came from. The officer unticks, edits, and confirms. Tasks are then created under that officer's own permission.
- **An owner only when one was named.** A task gets an owner only when a name or a role was said or written for it. Otherwise it shows "Who?" with a member picker. A wrong owner is worse than a blank one.
- **Two members with the same first name are the officer's pick,** never a guess.
- **A suggested task never carries points.** "Give Jake 50 points" spoken in a meeting is not an instruction. The officer adds points by hand.

## Standards meetings

A Standards meeting (a standards board or member-conduct hearing) is never recorded, never transcribed and never sent to a model.

- **None of the three ways offers the type.** Notes are covered as much as recordings: an officer can't paste hearing notes into the drafter and pick Standards.
- **The server refuses it too.** A request to draft minutes for a meeting typed Standards is rejected before any text is sent anywhere. The check does not live only in the app.
- **An officer writes Standards minutes by hand,** and they are stored in the [vault](vault.md), which the AI never reads. Until the vault exists they are kept outside Frapp.
- **Filing a hearing under another type to get a draft breaks this rule,** and the product can't detect it. The notes screen says so in one line where the type is picked.

## Recording notice

A meeting is recorded only after the room has been told.

- **The officer reads a short script aloud before recording starts,** for example: "This meeting is being recorded and transcribed by Frapp. Tell the secretary if you object."
- **Frapp posts a notice to the meeting's attendees.**
- **The recording phone shows a visible indicator for as long as it records.**
- **Anyone present may object, and the officer then doesn't record, or pauses.**

Apple requires explicit consent and a visible indication for any recording (App Review Guideline 2.5.14). Several states require every person present to agree, so a chapter in one of them should confirm the script with counsel first.

## Voices

Frapp stores no voiceprint and never recognises a member by voice. Speaker labels belong to one meeting ("Speaker 2"), and an officer maps a label to a name by hand. Nothing about a voice is kept or reused across meetings.

## Permissions

- Starting minutes, by notes, upload or recording, requires the `meetings:record` permission. Default seeds: President, Secretary, exec roles.
- Editing a posted summary requires `meetings:edit` (default: original recorder + President).
- Deleting a meeting record requires `meetings:delete` (default: President only).

## Retention

- **Raw audio is deleted when the minutes are posted.** A recording whose minutes are never posted is deleted after 30 days. Audio can't be anonymised when a member deletes their account, so it must already be gone.
- **Transcripts and posted minutes** follow the chapter's general [data retention](data-retention.md) policy. When a member deletes their account, their name on a speaker label becomes "Deleted User", as it does on their chat messages.
- **Standards minutes** in the vault follow the vault retention rules.
