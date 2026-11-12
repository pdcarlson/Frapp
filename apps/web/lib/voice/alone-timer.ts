/**
 * The voice prototype's "you're alone" rule (#3866; Shawn, 2026-11-12). See
 * `flag.ts`.
 *
 * Someone left alone in a voice chat is asked after 5 minutes whether they
 * want to stay, and is taken out after 10. A forgotten call costs the chapter
 * per-minute media fees on every provider we priced, and drains a phone. The
 * clock restarts when anyone else joins, or when the person says they're still
 * there.
 */

export const ALONE_WARN_MS = 5 * 60_000;
export const ALONE_LEAVE_MS = 10 * 60_000;

/**
 * Development only: shrink both limits to try the prompt without waiting
 * (`NEXT_PUBLIC_VOICE_ALONE_SCALE=0.01` makes them 3s and 6s).
 */
export function aloneScale(): number {
  const raw = Number(process.env.NEXT_PUBLIC_VOICE_ALONE_SCALE);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export type AloneStage = "none" | "ask" | "leave";

/** Where someone alone since `aloneSince` stands at `now`. */
export function aloneStage(
  aloneSince: number | null,
  now: number,
  scale = 1,
): AloneStage {
  if (aloneSince === null) return "none";
  const alone = now - aloneSince;
  if (alone >= ALONE_LEAVE_MS * scale) return "leave";
  if (alone >= ALONE_WARN_MS * scale) return "ask";
  return "none";
}
