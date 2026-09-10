export const FEATURE_FLAG_PROVIDER = 'FEATURE_FLAG_PROVIDER';

/**
 * Server-side product-flag evaluation. Distinct id and chapter group are
 * already HMAC hex — never raw ids.
 *
 * Flags are **not** an authorization input (ADR-22). Permission checks stay
 * in `can()` / guards. A flag may change copy or a rollout; it must not
 * substitute for `chapter-config:manage` or any other grant. Clients cannot
 * authorize themselves by evaluating a flag.
 */
export interface IFeatureFlagProvider {
  isEnabled(
    flagKey: string,
    distinctId: string,
    chapterGroupId?: string | null,
  ): Promise<boolean>;
}
