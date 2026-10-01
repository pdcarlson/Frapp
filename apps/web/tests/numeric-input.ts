/**
 * The entries every guarded numeric input is tested against (#2206,
 * `spec/engineering.md` § Input handling), in one place so each surface's spec
 * states the same cases.
 *
 * - **Refused:** a negative and a decimal reach `onChange` as typed, and the
 *   field must keep its previous value.
 * - **Read as a clear:** a `type="number"` input reports text it can't parse
 *   as `""`. jsdom sanitizes `"abc"` and `"1e999"` to `""` the way a browser
 *   reports bad input, so at a component those arrive exactly like an emptied
 *   field. The guard's handling of that raw text is pinned in
 *   `lib/utils.spec.ts`.
 */
import { fireEvent } from "@testing-library/react";
import { expect } from "vitest";

export const REFUSED_ENTRIES = ["-3", "1.5"] as const;
export const CLEARING_ENTRIES = ["", "abc", "1e999"] as const;

/** Types each refused entry after `kept`, and expects the field to keep `kept`. */
export function expectRefusedEntriesKeep(input: HTMLElement, kept: string) {
  fireEvent.change(input, { target: { value: kept } });
  expect(input).toHaveValue(Number(kept));
  for (const entry of REFUSED_ENTRIES) {
    fireEvent.change(input, { target: { value: entry } });
    expect(input, `after typing ${entry}`).toHaveValue(Number(kept));
  }
}

/**
 * Types each clearing entry after `from`, and expects the field to show
 * `cleared`: `null` for an emptied field, or the number a cleared field means.
 */
export function expectClearingEntriesShow(
  input: HTMLElement,
  from: string,
  cleared: number | null,
) {
  for (const entry of CLEARING_ENTRIES) {
    fireEvent.change(input, { target: { value: from } });
    fireEvent.change(input, { target: { value: entry } });
    expect(input, `after typing ${JSON.stringify(entry)}`).toHaveValue(cleared);
  }
}
