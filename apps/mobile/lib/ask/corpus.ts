/**
 * The Ask corpus — **entirely synthetic demo data**, behind an off-by-default
 * flag (`lib/ask/flag.ts`).
 *
 * Nothing in this file was retrieved from anything. The dues figure, the
 * meeting date, the vote tally and the study-hours requirement are invented
 * copy written to exercise s17's four rendering paths, and they are as fictional
 * as the `6.0` weekly study goal `spec/ui/mobile/screens.md` already calls out.
 * No API backs them and none ever will: `answerQuestion` is a keyword table.
 *
 * ## Reconciling two rules that look like they contradict
 *
 * Epic #937 says of this cluster: "Ask AI — no `ai` module in the API, by
 * design. Use `__mock` behind the flag." `spec/ui/mobile/screens.md:76` says
 * the opposite-sounding thing about every other unbacked element in the app:
 * "Elements drawn in Canvas that have no backing data are **omitted, not
 * faked**."
 *
 * They reconcile on *who sees the fake*. The omit-don't-fake rule exists to
 * stop a member believing a number the product made up — s15's "96% attendance"
 * would have been read as a real attendance record, so it was deleted rather
 * than stubbed. That failure needs a member on the other side of the screen.
 * Here there is none: `isAskAvailable()` is false unless a build explicitly
 * sets `EXPO_PUBLIC_ASK_ENABLED`, no shipped build sets it, and with it unset
 * the sheet renders the unavailable reason and never calls into this file. So
 * no fabricated answer reaches a member, and the rule is satisfied rather than
 * bent.
 *
 * What the mock buys is that the *screen* is real — the layout, the citation
 * chips, the refusal path and the in-flight state are all built and reviewable
 * against the drawing, so wiring a real retrieval service later is a data
 * change rather than a screen slice. The moment the flag can be turned on for
 * a real chapter, this file must be gone, not extended.
 *
 * ## What it models from `spec/behavior/ai.md`
 *
 * - **Every answer cites.** An `answered` result is structurally required to
 *   carry sources, and `corpus.spec.ts` pins that across the whole table.
 * - **Low confidence refuses rather than fabricates.** The `refused` branch is
 *   ai.md's own conflict case: two sources disagree, so the answer names the
 *   disagreement instead of synthesising it away.
 * - **"I don't know" when the corpus is silent** is the *default*, not an edge
 *   case — an unmatched question falls through to `unknown`.
 * - Citations arrive as structured spans rather than markdown in a string, so
 *   the renderer bolds the key figure without parsing prose. ai.md requires
 *   native structured citations for the same reason: parsing tokens out of free
 *   text is the failure mode that contract exists to avoid.
 *
 * **Known divergence, deliberate.** ai.md puts events and dues amounts
 * in the *live structured* half of the corpus — read at answer time through the
 * permission-guarded API, never indexed. This table flattens all of it into one
 * keyword lookup, because there is no `ai` module to route a tool call through.
 * A real implementation must not copy that shape; it is here only so the demo
 * questions have answers.
 */

/** One citation. `kind` mirrors ai.md's three indexed source families. */
export type AskSource = {
  kind: "document" | "minutes" | "channel";
  /** What the chip reads, as drawn on s17. */
  label: string;
};

/**
 * A run of answer text with optional emphasis.
 *
 * Spans rather than a marked-up string: `components.md` §11 bolds the answer's
 * key figure in gold and any secondary emphasis in the foreground, and a
 * renderer that had to find those by parsing `**` out of prose would be one
 * stray asterisk away from painting the wrong words gold.
 */
export type AnswerSpan = {
  text: string;
  /** `key` is the answer's key figure (gold); `strong` is secondary emphasis. */
  emphasis?: "key" | "strong";
};

export type AskAnswer =
  | { status: "answered"; spans: AnswerSpan[]; sources: AskSource[] }
  | { status: "refused"; message: string }
  | { status: "unknown"; message: string };

type CorpusEntry = {
  /**
   * Every keyword must appear in the lower-cased question for the entry to
   * match. Entries are tried in order, so a more specific entry has to sit
   * above the general one it would otherwise be swallowed by — which is why the
   * conflicting-dues refusal comes before the plain dues answer.
   */
  keywords: readonly string[];
  answer: AskAnswer;
};

/** What the corpus says when it has nothing. ai.md: say "I don't know". */
const SILENT: AskAnswer = {
  status: "unknown",
  message:
    "I don't know — nothing in your chapter's bylaws, minutes or announcements covers that. Try dues, study hours, the next mandatory event, or what the chapter last voted on.",
};

/**
 * The table. Exported so `corpus.spec.ts` can assert the citation invariant
 * across every entry rather than only the handful a spec thinks to ask about.
 */
export const ASK_CORPUS: readonly CorpusEntry[] = [
  {
    // The refusal path, and ai.md's own example of it: two sources disagree, so
    // the answer surfaces the conflict rather than picking a side.
    keywords: ["dues", "next"],
    answer: {
      status: "refused",
      message:
        "I found two different answers for next semester's dues — the March 3 minutes say $425 and the January budget packet says $390 — and nothing says which one replaced the other. Ask your treasurer rather than trusting either figure here.",
    },
  },
  {
    keywords: ["dues"],
    answer: {
      status: "answered",
      spans: [
        { text: "Dues are " },
        { text: "$425 per semester", emphasis: "key" },
        { text: ", due " },
        { text: "Sept 15", emphasis: "strong" },
        {
          text: ". Payment plans need treasurer approval one week before the deadline.",
        },
      ],
      sources: [
        { kind: "document", label: "Bylaws §4.2" },
        { kind: "minutes", label: "Minutes · Mar 3" },
        { kind: "channel", label: "#treasury" },
      ],
    },
  },
  {
    // Both words, not just "mandatory". As a lone keyword it is a *modifier*
    // that appears naturally in study, dues and vote questions, and sitting
    // above `["study"]` it swallowed them: "Are study hours mandatory?" — at
    // least as likely a phrasing as the drawn one — answered with the chapter
    // meeting, wearing Bylaws §2.1 and #announcements as citations. A
    // confidently wrong answer carrying real-looking sources is precisely the
    // failure `spec/behavior/ai.md` is written to prevent, and it is worse than
    // the `unknown` fallthrough.
    keywords: ["mandatory", "event"],
    answer: {
      status: "answered",
      spans: [
        { text: "The next mandatory event is " },
        { text: "chapter meeting, Sunday 7:00 PM", emphasis: "key" },
        { text: " in the great room. An unexcused absence costs " },
        { text: "10 points", emphasis: "strong" },
        { text: ", and excuses close 24 hours beforehand." },
      ],
      sources: [
        { kind: "document", label: "Bylaws §2.1" },
        { kind: "channel", label: "#announcements" },
      ],
    },
  },
  {
    keywords: ["vote"],
    answer: {
      status: "answered",
      spans: [
        { text: "The chapter voted to " },
        { text: "approve the $2,400 formal budget", emphasis: "key" },
        { text: ", " },
        { text: "31 for, 4 against", emphasis: "strong" },
        { text: ". The motion carried at the March 3 meeting." },
      ],
      sources: [
        { kind: "minutes", label: "Minutes · Mar 3" },
        { kind: "channel", label: "#announcements" },
      ],
    },
  },
  {
    keywords: ["study"],
    answer: {
      status: "answered",
      spans: [
        { text: "New members owe " },
        { text: "6 study hours a week", emphasis: "key" },
        { text: ", logged in the app. Actives below a " },
        { text: "3.0 GPA", emphasis: "strong" },
        { text: " owe the same until the next grade report clears them." },
      ],
      sources: [
        { kind: "document", label: "Bylaws §7.1" },
        { kind: "minutes", label: "Minutes · Feb 10" },
      ],
    },
  },
];

/**
 * The two chips drawn under the answer on s17.
 *
 * Both resolve to a real entry above, so tapping one never lands on "I don't
 * know" — a suggestion the product cannot answer is worse than no suggestion.
 */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  "When's the next mandatory event?",
  "What did we vote on last week?",
];

/**
 * Look a question up.
 *
 * Pure and synchronous: no clock, no network, no randomness, so the same
 * question always gives the same answer and the spec needs no fixtures. The
 * sheet, not this module, decides how long to hold the in-flight state.
 */
export function answerQuestion(question: string): AskAnswer {
  const needle = question.toLowerCase();

  const hit = ASK_CORPUS.find((entry) =>
    entry.keywords.every((keyword) => needle.includes(keyword)),
  );

  return hit?.answer ?? SILENT;
}
