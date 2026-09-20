/**
 * TZ is America/Los_Angeles (vitest.config + package.json `test` script), so a
 * case that would only pass at UTC fails here.
 *
 * Scope, stated exactly. This file does **not** hold the only coverage of
 * `parseInstant` — it cannot, because every member built on it parses through
 * it, so `locale.spec.ts`, `bare-date.spec.ts` and `protected-clusters.spec.ts`
 * all fail on a broken guard too (measured: dropping the non-string clause
 * reddens 5 cases across 3 files, only 1 of them here; dropping the NaN branch
 * reddens 7 across 4, only 2 here). That redundancy is the package working as
 * intended and is not something to delete.
 *
 * What this file adds is the primitive's contract stated **directly**, so a
 * change to it fails with a message naming it rather than naming a formatter,
 * plus the one case nothing else reaches: a bare-date-shaped string that is not
 * a date. An earlier draft asserted each member's placeholder over again; those
 * cases were removed because they restated `locale.spec.ts` verbatim, not
 * because member-level coverage is redundant.
 */
import { describe, expect, it } from "vitest";
import { parseInstant } from "./instant";
import { parseBareDateUtcNoon, parseInstantOrBareUtcNoon } from "./bare-date";

describe("parseInstant", () => {
  it("returns the parsed instant for a full ISO timestamp", () => {
    const parsed = parseInstant("2026-08-12T18:30:00Z");
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(Date.parse("2026-08-12T18:30:00Z"));
  });

  it("returns null rather than an Invalid Date for an unreadable string", () => {
    // The whole point: `new Date` hands back an object that renders as the
    // string "Invalid Date" instead of throwing.
    expect(new Date("not-a-date").toString()).toBe("Invalid Date");
    expect(parseInstant("not-a-date")).toBeNull();
  });

  it("rejects every non-string — including the ones `new Date` accepts", () => {
    // This is the clause with teeth, and the reason the guard is `unknown`
    // rather than `string`: drop it and a loosely-typed JSON field holding
    // `null` or `0` becomes a *valid* Date at the Unix epoch, so a caller
    // that renders "nothing" for an unknown timestamp renders "Dec 31, 1969".
    expect(new Date(null as unknown as number).getTime()).toBe(0);
    expect(new Date(0).getTime()).toBe(0);
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(0)).toBeNull();
    expect(parseInstant(new Date("2026-08-12T18:30:00Z"))).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant({})).toBeNull();
  });

  it("returns null for the empty string, which the NaN branch would too", () => {
    // Not a claim that the `value === ""` clause has teeth — it does not.
    // `new Date("")` is already an Invalid Date, so the clause only skips
    // constructing one and this case passes with it deleted. It is here to pin
    // the *result* for `""`, which callers do rely on, not the shortcut.
    expect(new Date("").toString()).toBe("Invalid Date");
    expect(parseInstant("")).toBeNull();
  });

  it("does not narrow a bare YYYY-MM-DD to the stored calendar day", () => {
    // The line between this primitive and the bare-date cluster: a date-only
    // string is UTC midnight here, which is the previous local day west of
    // Greenwich. `parseBareDateUtcNoon` is the member that fixes that, and
    // folding the two would silently re-break it.
    const bare = "2026-08-12";
    expect(parseInstant(bare)!.getDate()).toBe(11);
    expect(parseBareDateUtcNoon(bare)!.getDate()).toBe(12);
  });

  it("is the fallback that rejects a bare-date-shaped string that is not a date", () => {
    // `2026-13-45` matches BARE_DATE's `^\d{4}-\d{2}-\d{2}$`, so the noon
    // parse is attempted and yields null; only this primitive turns the
    // fall-through into a null too, and nothing else in the package covers it.
    expect(parseBareDateUtcNoon("2026-13-45")).toBeNull();
    expect(parseInstant("2026-13-45")).toBeNull();
    expect(parseInstantOrBareUtcNoon("2026-13-45")).toBeNull();
  });
});
