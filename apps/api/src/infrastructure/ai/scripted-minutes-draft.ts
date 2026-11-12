import type { MeetingDraftOutput } from '@repo/validation';
import { notesInPrompt } from '#domain/utils/minutes-draft';
import type { ScriptedHandler } from './scripted-language-model';

/**
 * The scripted adapter's reply for `minutes.draft`: a draft made from the
 * notes by fixed rules, so the flow can be walked locally with no key
 * (`AI_ENABLED=true AI_PROVIDER=scripted`). It is not a model and proves
 * nothing about one: it sorts the notes' own lines into sections by the
 * words they hold, quotes each line it uses, and names an owner only when a
 * roster name opens the line.
 *
 * It leaves the same gaps a careful model would (an action item with nobody
 * named, a vote with no count), so the review states are reachable too.
 */
export const scriptedMinutesDraft: ScriptedHandler = (request) => {
  const prompt = request.messages.at(-1)?.content ?? '';
  const draft = draftFrom(notesInPrompt(prompt), rosterNamesIn(prompt));
  return { text: JSON.stringify(draft), object: draft };
};

const DECISION = /\b(voted?|passed|failed|approved|motion|decided|agreed)\b/i;
const ACTION =
  /\b(will|to (?:book|send|email|call|post|order|buy|pick|write|collect|drop|talk|set|reserve|draft|follow|check|ask|bring|make|get|schedule|contact|update|submit|plan)|needs? to|someone needs)\b/i;
const ANNOUNCEMENT =
  /\b(reminder|remember|announce\w*|next (?:mtg|meeting)|due|deadline|sign ?up)\b/i;
const POINTS = /\bpoints?\b/i;
const ADDRESSED_TO_AI = /\b(AI|assistant|ignore (?:your|all|previous))\b/;
const UNNAMED = /\b(someone|somebody|we need|need a volunteer)\b/i;

function draftFrom(notes: string, roster: string[]): MeetingDraftOutput {
  const lines = notes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const draft: MeetingDraftOutput = {
    summary: '',
    announcements: '',
    decisions: [],
    action_items: [],
    officer_reports: '',
    old_business: '',
    new_business: '',
    discussion_log: '',
    open_questions: [],
  };
  const announcements: string[] = [];
  const discussion: string[] = [];

  for (const line of lines) {
    // A line that talks to the drafter is not followed and not written up.
    if (ADDRESSED_TO_AI.test(line)) continue;
    if (POINTS.test(line)) continue;
    const text = sentence(line);
    if (DECISION.test(line)) {
      const count = /(\d+)\s*(?:-|–|to)\s*(\d+)/.exec(line);
      draft.decisions.push({
        text,
        vote: count
          ? { for: Number(count[1]), against: Number(count[2]), abstain: 0 }
          : null,
        quote: line,
      });
      if (!count) {
        draft.open_questions.push(
          `The notes don't give a vote count for "${short(text)}".`,
        );
      }
    } else if (ACTION.test(line)) {
      const owner = UNNAMED.test(line) ? null : ownerOpening(line, roster);
      draft.action_items.push({ text, owner, due_date: null, quote: line });
      if (!owner) {
        draft.open_questions.push(
          `The notes don't settle who is doing "${short(text)}".`,
        );
      }
    } else if (ANNOUNCEMENT.test(line)) {
      announcements.push(text);
    } else {
      discussion.push(text);
    }
  }

  draft.announcements = announcements.join('\n');
  draft.discussion_log = discussion.join('\n');
  draft.summary =
    lines.length === 0
      ? ''
      : `The meeting covered ${count(discussion.length + announcements.length, 'item')}, made ${count(draft.decisions.length, 'decision')} and left ${count(draft.action_items.length, 'action item')}.`;
  return draft;
}

/** The names on the prompt's roster, longest first. */
function rosterNamesIn(prompt: string): string[] {
  const start = prompt.indexOf('Roster (');
  const end = prompt.indexOf('\nNotes:\n');
  if (start < 0 || end < start) return [];
  return prompt
    .slice(start, end)
    .split('\n')
    .slice(1)
    .map((line) =>
      line
        .replace(/\s*\*$/, '')
        .replace(/\s*\(.*\)$/, '')
        .trim(),
    )
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
}

/**
 * The one roster member a line names by full or first name, or null when it
 * names none or could mean two.
 */
function ownerOpening(line: string, roster: string[]): string | null {
  const lower = line.toLowerCase();
  const word = (name: string) =>
    new RegExp(
      `(?<![a-z])${name.toLowerCase().replace(/[^a-z ]/g, '')}(?![a-z])`,
    );
  const full = roster.filter((name) => word(name).test(lower));
  if (full.length === 1) return full[0];
  const first = roster.filter((name) => word(name.split(/\s+/)[0]).test(lower));
  return first.length === 1 ? first[0] : null;
}

function sentence(line: string): string {
  const text = line.replace(/^[-*•]\s*/, '').trim();
  const capped = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function short(text: string): string {
  const plain = text.replace(/\.$/, '');
  return plain.length > 60 ? `${plain.slice(0, 57)}...` : plain;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
