import type { EvalCase } from '../harness/types';
import { conflictingSourcesCases } from './conflicting-sources.cases';
import { missingInformationCases } from './missing-information.cases';
import { promptInjectionCases } from './prompt-injection.cases';
import { staleInformationCases } from './stale-information.cases';

/** The full adversarial corpus mandated by `spec/architecture/README.md` §13 → Evals. */
export const allEvalCases: EvalCase[] = [
  ...staleInformationCases,
  ...conflictingSourcesCases,
  ...missingInformationCases,
  ...promptInjectionCases,
];

export {
  conflictingSourcesCases,
  missingInformationCases,
  promptInjectionCases,
  staleInformationCases,
};
