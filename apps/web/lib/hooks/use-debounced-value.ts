/**
 * The shared trailing-edge debounce, `useDebouncedValue` in `@repo/hooks`
 * (`packages/hooks/src/use-debounced-value.ts`), which web and the phone both
 * use. Kept as this path so specs can stub the debounce for one component
 * without mocking all of `@repo/hooks`, and read from the hook's own subpath
 * so a spec that mocks `@repo/hooks` doesn't take the debounce with it.
 */
export { useDebouncedValue } from "@repo/hooks/use-debounced-value";
