/**
 * Test fixtures for #2664, shared by the three specs that pin it: chat-core's
 * `markdown-parse-budget.spec.ts`, web's `text-renderer.spec.tsx` and
 * mobile's `message-markdown.spec.tsx`. One copy, so retuning a budget can't
 * update one spec's bodies and leave another's testing a stale edge. Nothing
 * outside a spec imports this.
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
  /**
   * Whether a renderer that parsed it would draw something other than the
   * raw text. For these, "draws the raw text" is a structural test that the
   * parse was skipped. For the rest, the depth cap after the parse would draw
   * the same raw text, so only a spec's time bound can tell.
   */
  parsedDiffers: boolean;
}

/**
 * Bodies within the length cap that micromark's inline parse took hundreds of
 * milliseconds to seconds on. Timings are remark-parse alone (Node 24,
 * micromark 4.0.2), measured 2026-09-30 before the check existed. The first
 * six are the issue's table.
 */
export const COSTLY_MARKDOWN_BODIES: readonly CostlyMarkdownBody[] = [
  {
    label: "an underscore run (1.2–1.8 s)",
    body: "_".repeat(4999) + "a" + "_".repeat(4999),
    parsedDiffers: false,
  },
  {
    label: "a strong run (1.3 s)",
    body: "**".repeat(2499) + "a" + "**".repeat(2499),
    parsedDiffers: false,
  },
  {
    // The issue listed this at 1.1 s; it measured 50–90 ms here. Kept because
    // it is in the issue's minimum set, and the parse would link it.
    label: "open brackets closed by links (50–90 ms)",
    body: "[".repeat(3000) + "a" + "](u)".repeat(1000),
    parsedDiffers: true,
  },
  {
    label: "alternating openers closed in reverse (0.7–1.3 s)",
    body: nestedOpeners(1600),
    parsedDiffers: false,
  },
  {
    label: "brackets (1.5–1.7 s)",
    body: "[".repeat(4999) + "a" + "]".repeat(4999),
    parsedDiffers: false,
  },
  {
    label: "star-a pairs (0.3 s)",
    body: "*a".repeat(2400) + "x" + "a*".repeat(2400),
    parsedDiffers: true,
  },
  {
    label: "a star-a run (0.2 s)",
    body: "*a".repeat(5000),
    parsedDiffers: true,
  },
  {
    label: "nested images (1.2–1.6 s)",
    body: "![".repeat(2499) + "a" + "](u)".repeat(1249),
    parsedDiffers: false,
  },
  {
    // Failing closers walk back over every event; escapes multiply them.
    label: "closers after escapes (0.3 s)",
    body: fill("\\&", CAP - 3000) + "a* ".repeat(1000),
    parsedDiffers: true,
  },
  {
    label: "unmatched `]` after entities (0.2–0.3 s)",
    body: fill("&amp;", CAP - 3000) + "] ".repeat(1500),
    parsedDiffers: true,
  },
  {
    // An unclosed raw-HTML opener scans to the paragraph's end. The leading
    // `x ` keeps it out of an HTML block, so it is inline.
    label: "unclosed `<?` openers (0.5–0.7 s)",
    body: "x " + "<?".repeat(4999),
    parsedDiffers: false,
  },
  {
    label: "unclosed `<!A` openers (0.3–0.5 s)",
    body: "x " + "<!A".repeat(3332),
    parsedDiffers: false,
  },
  {
    label: "unclosed `<!--` openers after entities (0.3 s)",
    body: "x &amp; " + "<!--".repeat(2497),
    parsedDiffers: true,
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
