/**
 * Compile-time drift guards between a response DTO and the row or view it
 * publishes.
 *
 * `AssertNever<X>` only type-checks while `X` is `never`. A DTO file declares
 * `type …MissingFields = AssertNever<Exclude<keyof Row, keyof Dto>>` (and the
 * reverse for extra fields); when the two drift, the alias stops satisfying
 * the constraint and the build fails naming the field.
 *
 * The guard aliases are exported and carry the `driftguard` JSDoc tag:
 * exported so ESLint's no-unused-vars leaves them alone, tagged so knip does
 * too (`knip.jsonc` excludes the tag). Nothing imports a guard; tsc checking
 * it is the whole point.
 */
export type AssertNever<T extends never> = T;
