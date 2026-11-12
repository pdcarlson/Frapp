/**
 * How the AI corpus ranks what it retrieved (#720,
 * `spec/architecture/README.md` § 13 Retrieval).
 */

/**
 * Bump this when the way a source becomes passages changes (the chunker, the
 * extractor, what a minutes section renders as). Every source indexed under
 * an older number is then indexed again in the background.
 */
export const CORPUS_PIPELINE_VERSION = 1;

/**
 * What a source's passages were made with. A source whose stored fingerprint
 * differs from the current one is stale: its model, its vector width or the
 * pipeline changed. Built from characters an AI run's dedupe key allows.
 */
export function corpusFingerprint(model: string, dimensions: number): string {
  return `${model}.${dimensions}.p${CORPUS_PIPELINE_VERSION}`;
}

/**
 * The constant in reciprocal rank fusion. 60 is the value from the paper
 * that introduced it and the one Supabase's hybrid search uses; it keeps the
 * top of one list from drowning out a passage both lists agree on.
 */
export const RRF_K = 60;

/**
 * Reciprocal rank fusion: a passage's score is the sum, over the lists it
 * appears in, of 1 / (k + its rank there). It needs no calibration between a
 * cosine distance and a text-search score, which is why it merges the two
 * halves here (ADR-28 decision 3). A null rank is a list the passage is not
 * in.
 */
export function reciprocalRankFusion(
  ranks: ReadonlyArray<number | null>,
  k = RRF_K,
): number {
  return ranks.reduce<number>(
    (sum, rank) => (rank === null ? sum : sum + 1 / (k + rank)),
    0,
  );
}

/** Minutes lose half their recency bonus every half a year. */
export const CORPUS_DECAY_HALF_LIFE_DAYS = 180;

/**
 * The recency weight of a source that decays: 1 when new, falling toward 0.5
 * as it ages, so a newer source outranks an older one on the same question
 * and an old one is never pushed out of reach. The floor matters: two
 * sources that disagree must both be retrievable for an answer to show the
 * disagreement.
 */
export function recencyWeight(
  ageDays: number,
  halfLifeDays = CORPUS_DECAY_HALF_LIFE_DAYS,
): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return 0.5 + 0.5 * Math.pow(2, -ageDays / halfLifeDays);
}
