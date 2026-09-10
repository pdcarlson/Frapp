/**
 * Product-only feature flags. Never an authorization input — `can()` in
 * `@repo/validation` is the permission check. A flag may change copy, a
 * prompt, or a rollout; it must not substitute for `chapter-config:manage`
 * or any other grant.
 */
export { isProductFlagEnabled } from "@repo/observability";
