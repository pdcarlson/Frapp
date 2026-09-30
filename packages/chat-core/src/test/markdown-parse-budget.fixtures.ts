/**
 * Test fixtures for #2664, shared by the three specs that pin it: chat-core's
 * `markdown-parse-budget.spec.ts`, web's `text-renderer.spec.tsx` and
 * mobile's `message-markdown.spec.tsx`. One copy, so retuning a budget can't
 * update one spec's bodies and leave another's testing a stale edge. Nothing
 * outside a spec imports this; it sits under `test/`, which dependency-cruiser
 * treats as code that never ships.
 */

const CAP = 10_000;

const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

/** `*a _a *a …` openers, `count` deep, then `x`, then their closers in reverse. */
function nestedOpeners(count: number): string {
  const markers = Array.from({ length: count }, (_, i) => (i % 2 ? "_" : "*"));
  const open = markers.map((marker) => `${marker}a `).join("");
  const close = [...markers]
    .reverse()
    .map((marker) => ` a${marker}`)
    .join("");
  return open + "x" + close;
}

export interface CostlyMarkdownBody {
  /** What the body is, and what remark-parse alone took on it before #2664. */
  label: string;
  body: string;
}

/**
 * Bodies within the length cap that micromark's parse was slow on. Timings
 * are remark-parse alone (Node 24, micromark 4.0.2), measured 2026-09-30
 * before the check existed. Most took hundreds of milliseconds to seconds.
 * The first six are the issue's table, which includes one that measured cheap
 * here (open brackets closed by links); it stays as part of the issue's
 * minimum set.
 */
export const COSTLY_MARKDOWN_BODIES: readonly CostlyMarkdownBody[] = [
  {
    label: "an underscore run (1.2–1.8 s)",
    body: "_".repeat(4999) + "a" + "_".repeat(4999),
  },
  {
    label: "a strong run (1.3 s)",
    body: "**".repeat(2499) + "a" + "**".repeat(2499),
  },
  {
    // The issue listed this at 1.1 s; it measured 50–90 ms here. Kept because
    // it is in the issue's minimum set, and the parse would link it.
    label: "open brackets closed by links (50–90 ms)",
    body: "[".repeat(3000) + "a" + "](u)".repeat(1000),
  },
  {
    label: "alternating openers closed in reverse (0.7–1.3 s)",
    body: nestedOpeners(1600),
  },
  {
    label: "brackets (1.5–1.7 s)",
    body: "[".repeat(4999) + "a" + "]".repeat(4999),
  },
  {
    label: "star-a pairs (0.3 s)",
    body: "*a".repeat(2400) + "x" + "a*".repeat(2400),
  },
  {
    label: "a star-a run (0.2 s)",
    body: "*a".repeat(5000),
  },
  {
    label: "nested images (1.2–1.6 s)",
    body: "![".repeat(2499) + "a" + "](u)".repeat(1249),
  },
  {
    // Failing closers walk back over every event; escapes multiply them.
    label: "closers after escapes (0.3 s)",
    body: fill("\\&", CAP - 3000) + "a* ".repeat(1000),
  },
  {
    label: "unmatched `]` after entities (0.2–0.3 s)",
    body: fill("&amp;", CAP - 3000) + "] ".repeat(1500),
  },
  {
    // An unclosed raw-HTML opener scans to the paragraph's end. The leading
    // `x ` keeps it out of an HTML block, so it is inline.
    label: "unclosed `<?` openers (0.5–0.7 s)",
    body: "x " + "<?".repeat(4999),
  },
  {
    label: "unclosed `<!A` openers (0.3–0.5 s)",
    body: "x " + "<!A".repeat(3332),
  },
  {
    label: "unclosed `<!--` openers after entities (0.3 s)",
    body: "x &amp; " + "<!--".repeat(2497),
  },
  {
    // Block structure: lines with no marker continue the quote's paragraph
    // lazily, and micromark re-checks the quote on each one.
    label: "a quote continued lazily for 4,998 lines (0.45 s)",
    body: ">a\n" + "b\n".repeat(4998),
  },
  {
    label: "a list of 2,500 items (0.13 s)",
    body: "- a\n".repeat(2500),
  },
  {
    label: "555 lines of eight nested list markers (0.13 s)",
    body: "- - - - - - - - a\n".repeat(555),
  },
];

/**
 * Among the slowest bodies the budgets let through: openers closed in
 * reverse, padded with entities, which multiply the events the emphasis
 * resolver walks. It goes through the parse (the depth cap then flattens it,
 * since it nests past 32) in tens of milliseconds.
 */
export const NEAR_BUDGET_MARKDOWN_BODY: string = (() => {
  const nest = nestedOpeners(32);
  const [open, close] = nest.split("x") as [string, string];
  const pad = "&amp;x".repeat(
    Math.floor((9_000 - open.length - close.length) / 6),
  );
  return open + pad + close;
})();
