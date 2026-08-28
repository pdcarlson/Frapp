# Meetings

Frapp records chapter meetings (audio transcription + AI summary) as a paid-tier feature. Meeting transcripts and summaries land in the [AI corpus](ai.md), giving the chapter searchable institutional memory of what was discussed and decided.

## Meeting type metadata

At recording start, the user selects a **meeting type**:

| Type        | Example                                          |
| ----------- | ------------------------------------------------ |
| Chapter     | Full chapter meeting (most common).              |
| Exec        | Officer / exec board meeting.                    |
| Committee   | Committee or working-group meeting.              |
| Standards   | Standards board / member-conduct hearing.        |
| Other       | Anything else (free-form label optional).        |

The type is captured as metadata on the recording and persists through transcription. It is **not** a separate template; rather, the AI summarizer uses it to vary tone and emphasis:

- **Chapter**: balanced minutes — attendance, announcements, decisions, action items.
- **Exec**: decisions and action items emphasized; lower-priority on the full discussion log.
- **Committee**: focus on action items and follow-ups; lighter on attendance.
- **Standards**: terse, decision-only. Output lands in [vault](vault.md) by default rather than in `#meetings`.
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

1. Officer with the meeting permission starts a recording, selects meeting type.
2. Audio is captured (mobile or web). Transcription happens server-side via a Whisper-equivalent service.
3. AI summarizer produces the templated summary using the meeting type as context.
4. Officer reviews and edits the summary before posting.
5. On post, the summary lands in:
   - `#meetings` for Chapter / Exec / Committee types.
   - Vault for Standards type (see [`vault.md`](vault.md)).
   - The selected destination for Other type.
6. The full transcript is retained and indexed for AI Q&A (see [`ai.md`](ai.md)).

## Permissions

- Recording a meeting requires the `meetings:record` permission. Default seeds: President, Secretary, exec roles.
- Editing a posted summary requires `meetings:edit` (default: original recorder + President).
- Deleting a meeting record requires `meetings:delete` (default: President only).

## Retention

Meeting transcripts and summaries follow the chapter's general [data retention](data-retention.md) policy. Standards-type meetings in the vault follow the vault retention rules.
