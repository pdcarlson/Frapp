import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import type { ScriptedReply } from './scripted-language-model';

/**
 * What the scripted adapter answers for the acting agent's two tasks in the
 * running app (`AI_PROVIDER=scripted`), so "Do" can be walked end to end
 * with no key.
 *
 * Neither is a model. The planner reads the request with a few patterns,
 * enough for the three example requests the panel offers and their close
 * variants; anything else comes back as "none of the actions fits". The
 * matcher places a name on the one roster line whose first name starts the
 * same way.
 */

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function addDays(day: string, count: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + count);
  return isoDay(at);
}

/** The day a request names, worked out from the prompt's "Today is". */
function dayIn(text: string, today: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(tonight|today)\b/.test(lower)) return today;
  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  if (/\b(yesterday|last night)\b/.test(lower)) return addDays(today, -1);
  const named = new RegExp(`\\b(${MONTHS.join('|')}) (\\d{1,2})\\b`).exec(
    lower,
  );
  if (named) {
    const month = MONTHS.indexOf(named[1]);
    const year = Number(today.slice(0, 4));
    const at = new Date(Date.UTC(year, month, Number(named[2])));
    if (isoDay(at) < today) at.setUTCFullYear(year + 1);
    return isoDay(at);
  }
  const weekday = new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`).exec(lower);
  if (weekday) {
    const now = new Date(`${today}T00:00:00Z`).getUTCDay();
    const ahead = (WEEKDAYS.indexOf(weekday[1]) - now + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  return null;
}

/** "at 7" (evening assumed below 8), "at 7:30pm", "at 19:00". */
function timeIn(text: string): string | null {
  const found = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!found) return null;
  let hour = Number(found[1]);
  const half = found[3]?.toLowerCase();
  if (half === 'pm' && hour < 12) hour += 12;
  if (half === 'am' && hour === 12) hour = 0;
  if (!half && hour < 8) hour += 12;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${found[2] ?? '00'}`;
}

function listOf(text: string): string[] {
  return text
    .split(/,| and /i)
    .map((name) => name.trim())
    .filter(Boolean);
}

const WHEN_TAIL = new RegExp(
  `\\s*\\b(?:(?:by|on|for|this|next)\\s+)*(?:tonight|today|tomorrow|yesterday|last night|${WEEKDAYS.join('|')}|(?:${MONTHS.join('|')}) \\d{1,2})\\b.*$`,
  'i',
);

function clean(text: string | undefined): string | null {
  const flat = (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '')
    .trim();
  return flat || null;
}

/** `act.plan`: the request read with a few patterns. */
export function scriptedActPlan(request: LanguageModelRequest): ScriptedReply {
  const message = request.messages.at(-1)?.content ?? '';
  const [requestPart, actionsPart = ''] = message.split('\n\nActions:\n');
  // In a conversation the officer's earlier messages come first; the request
  // is the last "Request:" line on.
  const said = (
    /(?:^|\n)Request: ([\s\S]*)$/.exec(requestPart)?.[1] ?? ''
  ).trim();
  const offered = new Set(
    [...actionsPart.matchAll(/^- ([a-z_]+):/gm)].map((match) => match[1]),
  );
  const today =
    /Today is (\d{4}-\d{2}-\d{2})/.exec(request.system ?? '')?.[1] ??
    isoDay(new Date());

  const plan = {
    action: 'none',
    people: [] as string[],
    everyone_who_attended: false,
    event_name: null as string | null,
    date: dayIn(said, today),
    start_time: null as string | null,
    end_time: null as string | null,
    amount: null as number | null,
    title: null as string | null,
    details: null,
    location: null as string | null,
    required: null as boolean | null,
  };

  const points = /(-?\d+)\s+points?\b/i.exec(said);
  if (points && offered.has('give_points')) {
    plan.action = 'give_points';
    const size = Math.abs(Number(points[1]));
    plan.amount = /\b(take|remove|deduct|dock)\b/i.test(said) ? -size : size;
    const attended =
      /everyone (?:who|that) (?:came|went|showed up|attended|was at)(?: to)?\s*(.*)$/i.exec(
        said,
      );
    if (attended) {
      plan.everyone_who_attended = true;
      const rest = attended[1]
        .replace(/\bfor\b.*$/i, '')
        .replace(WHEN_TAIL, '');
      plan.event_name = clean(rest);
    } else {
      const who = /\b(?:to|from)\s+(.+?)(?:\s+for\b|$)/i.exec(
        said.slice(points.index + points[0].length),
      );
      plan.people = listOf(who?.[1] ?? '');
    }
    plan.title = clean(/\bfor\s+(?!everyone)(.+)$/i.exec(said)?.[1]);
  } else if (/\b(task|to-?do)\b/i.test(said) && offered.has('create_task')) {
    plan.action = 'create_task';
    const shaped = /\bfor\s+(.+?)\s+to\s+(.+)$/i.exec(said);
    if (shaped) {
      plan.people = listOf(shaped[1]);
      plan.title = clean(shaped[2].replace(WHEN_TAIL, ''));
    } else {
      plan.title = clean(
        /\b(?:task|to-?do)\s*(?:to|:)?\s*(.+)$/i
          .exec(said)?.[1]
          ?.replace(WHEN_TAIL, ''),
      );
    }
  } else if (
    /\b(event|calendar|schedule)\b/i.test(said) &&
    offered.has('create_event')
  ) {
    plan.action = 'create_event';
    const named =
      /\b(?:put|add|schedule|create)\s+(?:an?\s+|the\s+)?(.+?)(?:\s+on the calendar|\s+event\b|\s+for\b|\s+on\b|\s+at\b|$)/i.exec(
        said,
      );
    plan.title = clean(named?.[1]);
    plan.start_time = timeIn(said);
    plan.location = clean(
      /\bat the\s+(.+?)(?:\s+(?:on|at|for)\b|$)/i.exec(said)?.[1],
    );
    if (/\b(required|mandatory)\b/i.test(said)) plan.required = true;
  }
  return { text: JSON.stringify(plan), object: plan };
}

/** `act.match`: the one member whose first name starts like the typed name. */
export function scriptedActMatch(request: LanguageModelRequest): ScriptedReply {
  const message = request.messages.at(-1)?.content ?? '';
  const [namesPart, membersPart = ''] = message.split('\n\nMembers:\n');
  const names = [...namesPart.matchAll(/^- (.+)$/gm)].map((match) => match[1]);
  const members = [...membersPart.matchAll(/^(\d+)\. (.*)$/gm)].map(
    (match) => ({
      line: Number(match[1]),
      first: match[2].trim().split(/\s+/)[0]?.toLowerCase() ?? '',
    }),
  );
  const matches = names.map((name) => {
    const stem = name.trim().toLowerCase().slice(0, 3);
    const fits =
      stem.length < 3
        ? []
        : members.filter((member) => member.first.startsWith(stem));
    return { name, member: fits.length === 1 ? fits[0].line : null };
  });
  return { text: JSON.stringify({ matches }), object: { matches } };
}
