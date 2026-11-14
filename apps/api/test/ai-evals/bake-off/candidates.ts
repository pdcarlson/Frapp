/**
 * The models a bake-off can put under the same eval cases (#4311).
 *
 * A candidate is a provider, a model id and a price. The bake-off swaps the
 * candidate in below the gateway's port, so the gateway, the catalog's
 * output ceiling and effort, and Frapp's checks are exactly the product's;
 * only the model answering changes. Moving a feature to the winner is then
 * one edit to `src/domain/constants/ai-model-catalog.ts`.
 *
 * Prices are US dollars per million tokens, observed on the date given, and
 * are what the table's cost column uses. They are an estimate from token
 * counts, not an invoice. Claude's were read from Anthropic's model table
 * (ADR-28, "Prices the estimates used"). Gemini's, and both Gemini model
 * ids, come from search results: the sessions that wrote ADR-28 and this
 * file could not open Google's pages. Check them in Model Garden before a
 * paid run, and correct this file if they differ.
 */
import type { AiProvider } from '#domain/adapters/language-model.interface';
import { AI_MODEL_CATALOG } from '#domain/constants/ai-model-catalog';

/**
 * The incumbent's price is the catalog's, so the gateway's spend estimate
 * and the bake-off's cost column can't disagree.
 */
const INCUMBENT = AI_MODEL_CATALOG['minutes.draft'];

export interface CandidatePrice {
  /** First day this price applies, `YYYY-MM-DD`. */
  from: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export interface BakeOffCandidate {
  /** What `--models` and `AI_EVALS_MODEL` take. */
  id: string;
  provider: AiProvider;
  /** The provider's model id, sent as is. */
  model: string;
  /** Oldest first. The price on a run's date is the last one not after it. */
  prices: CandidatePrice[];
  /** Where the prices came from, and whether anyone checked them at the source. */
  priceSource: string;
  /** False for the scripted model: no network, no cost, no key. */
  paid: boolean;
}

export const BAKE_OFF_CANDIDATES: readonly BakeOffCandidate[] = [
  {
    id: INCUMBENT.model,
    provider: INCUMBENT.provider,
    model: INCUMBENT.model,
    prices: [
      {
        from: '2026-01-01',
        inputUsdPerMillionTokens: INCUMBENT.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: INCUMBENT.outputUsdPerMillionTokens,
      },
    ],
    priceSource:
      "The model catalog's price (Anthropic's model table, read 2026-11-11, ADR-28)",
    paid: true,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    prices: [
      {
        from: '2026-01-01',
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.5,
      },
    ],
    priceSource:
      "Anthropic's model table, read 2026-11-11 (ADR-28); 5x above 100k prompt tokens, which no case reaches",
    paid: true,
  },
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    prices: [
      {
        from: '2026-01-01',
        inputUsdPerMillionTokens: 4,
        outputUsdPerMillionTokens: 20,
      },
    ],
    priceSource:
      "Anthropic's model table as cached 2026-11-03 ($4 in, $20 out; cache reads $0.20, which this estimate does not discount)",
    paid: true,
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'google',
    model: 'gemini-3.8-flash',
    prices: [
      {
        from: '2026-01-01',
        inputUsdPerMillionTokens: 0.75,
        outputUsdPerMillionTokens: 3.75,
      },
      {
        from: '2027-01-01',
        inputUsdPerMillionTokens: 1.5,
        outputUsdPerMillionTokens: 7.5,
      },
    ],
    priceSource:
      'Search results, 2026-11-11 (ADR-28); not read at Google. Model id unverified',
    paid: true,
  },
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    prices: [
      {
        from: '2026-01-01',
        inputUsdPerMillionTokens: 0.3,
        outputUsdPerMillionTokens: 2.5,
      },
    ],
    priceSource:
      'Search results, 2026-11-11 (ADR-28); not read at Google. Model id unverified',
    paid: true,
  },
  {
    id: 'scripted',
    provider: 'scripted',
    model: 'scripted',
    prices: [
      {
        from: '2026-01-01',
        inputUsdPerMillionTokens: 0,
        outputUsdPerMillionTokens: 0,
      },
    ],
    priceSource:
      'No model: canned replies, for CI and for checking the harness',
    paid: false,
  },
];

export function findCandidate(id: string): BakeOffCandidate {
  const candidate = BAKE_OFF_CANDIDATES.find((c) => c.id === id);
  if (!candidate) {
    throw new Error(
      `Unknown bake-off model "${id}". Known: ${BAKE_OFF_CANDIDATES.map((c) => c.id).join(', ')}.`,
    );
  }
  return candidate;
}

export function priceOn(
  candidate: BakeOffCandidate,
  day: string,
): CandidatePrice {
  const applicable = candidate.prices.filter((price) => price.from <= day);
  const price = applicable.at(-1);
  if (!price) throw new Error(`${candidate.id} has no price on ${day}`);
  return price;
}

/** Estimated cost in US dollars from token counts. */
export function costUsd(
  price: CandidatePrice,
  tokens: { inputTokens: number; outputTokens: number },
): number {
  return (
    (tokens.inputTokens * price.inputUsdPerMillionTokens +
      tokens.outputTokens * price.outputUsdPerMillionTokens) /
    1_000_000
  );
}
