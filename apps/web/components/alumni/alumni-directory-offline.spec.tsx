import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { networkMock } from "@/tests/network";

/**
 * #1621 — the alumni surface must keep cached rows on screen when it goes
 * OFFLINE, per `spec/ui/resilience.md` § 2 (OFFLINE ⇒ Read Actions "Enabled
 * (from cache)").
 *
 * The first test file this component has had. It exists mainly for the Retry
 * path, which on this surface does more than the bare `refetch()` most of the
 * eighteen gates pass — `members-directory.tsx` (clears the search) and
 * `points/page.tsx` (resets `window` and `semesterArchiveId`) share that.
 * (Eighteen, not the seventeen an earlier draft said: `study-page.tsx`'s gate
 * is Prettier-wrapped across four lines, so a one-line grep for
 * `isOffline && …anyReadUncached` misses it. Count with a multiline search.) `useAlumni`
 * sets `placeholderData: keepPreviousData`, so committing a filter offline
 * keys the query to something never fetched and hands back the *previous*
 * key's rows as placeholder data. The gate counts that as uncached and
 * replaces the whole directory — including the filter form and its Clear
 * button — so Retry is the only control the member has left, and what it
 * resets is the whole of their escape.
 */

const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));

type AlumniQuery = {
  data: unknown;
  // `isPending`, not `isLoading`: `alumni-directory.tsx` branches on the
  // former, so a fixture declaring the latter leaves the loading rung
  // permanently `undefined` and unreachable in every case in this file.
  isPending: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  refetch: () => void;
};

function read(): AlumniQuery {
  return {
    data: [],
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  };
}

/**
 * Two reads, keyed the way TanStack keys them, because the Retry escape *is* a
 * per-key distinction: the filtered key holds placeholder rows while the base
 * key still holds real cached ones. One global fixture cannot express that,
 * and a test built on one can never show the card actually clearing — only
 * which filters were committed.
 */
const baseRead = read();
const filteredRead = read();

const ALUMNI = [
  {
    id: "al-1",
    user_id: "u-1",
    display_name: "Ada Lovelace",
    bio: null,
    avatar_url: null,
    graduation_year: 2018,
    current_city: "Austin",
    current_company: "Analytical Engines",
    email: null,
  },
];

type Filters = Record<string, string | undefined> | undefined;

/** `{ a: undefined }` and `{}` hash to the same TanStack key. */
function isBaseKey(filters: Filters) {
  return !filters || Object.values(filters).every((v) => v === undefined);
}

/** The filters the component committed, newest last. */
const committedFilters: Array<Filters> = [];

vi.mock("@repo/hooks", () => ({
  useAlumni: (filters: Filters) => {
    committedFilters.push(filters);
    return isBaseKey(filters) ? baseRead : filteredRead;
  },
}));

vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (state: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

import { AlumniDirectory } from "./alumni-directory";

beforeEach(() => {
  vi.clearAllMocks();
  committedFilters.length = 0;
  mockOffline.value = false;
  Object.assign(baseRead, read());
  Object.assign(filteredRead, read());
});

const OFFLINE_COPY = "Alumni directory unavailable offline";

function lastCommitted() {
  return committedFilters[committedFilters.length - 1];
}

/** Type all three filters and commit them, moving the query onto a new key. */
async function applyFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Graduation year"), "2018");
  await user.type(screen.getByLabelText("City"), "Austin");
  await user.type(screen.getByLabelText("Company"), "Analytical Engines");
  await user.click(screen.getByRole("button", { name: /apply filters/i }));
}

describe("AlumniDirectory offline read path (#1621)", () => {
  it("keeps rendering cached alumni when it goes offline", () => {
    mockOffline.value = true;
    baseRead.data = ALUMNI;

    render(<AlumniDirectory />);

    expect(screen.queryByText(OFFLINE_COPY)).not.toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("withholds the directory when the read holds nothing", () => {
    mockOffline.value = true;
    baseRead.data = undefined;

    render(<AlumniDirectory />);

    expect(screen.getByText(OFFLINE_COPY)).toBeInTheDocument();
  });

  it("treats another key's rows held as placeholder data as uncached", () => {
    // `keepPreviousData` means `data === undefined` can never fire here after
    // the first load, so without the `isPlaceholderData` clause this surface
    // would render the previous filter's alumni under the new filter's chips.
    mockOffline.value = true;
    baseRead.data = ALUMNI;
    baseRead.isPlaceholderData = true;

    render(<AlumniDirectory />);

    expect(screen.getByText(OFFLINE_COPY)).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("dismisses the card on Retry while still offline", async () => {
    // The point of the escape, and the case a single-read fixture cannot
    // state: the member never regains the network here. Retry has to move the
    // surface back onto a key that is cached, or the card that replaced the
    // whole directory — Clear button included — stays up until the connection
    // returns on its own.
    const user = userEvent.setup();
    baseRead.data = ALUMNI;
    filteredRead.data = ALUMNI;
    filteredRead.isPlaceholderData = true;

    const { rerender } = render(<AlumniDirectory />);

    await applyFilters(user);

    // `rerender` rather than a fresh `render`: the committed filters are
    // component state, so remounting would reset the thing under test.
    mockOffline.value = true;
    rerender(<AlumniDirectory />);
    expect(screen.getByText(OFFLINE_COPY)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retry now/i }));

    expect(mockOffline.value).toBe(true);
    expect(screen.queryByText(OFFLINE_COPY)).not.toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(isBaseKey(lastCommitted())).toBe(true);
  });

  it("clears the filter form along with the committed filters on Retry", async () => {
    // The inputs reset with the key, not independently. Dropping `committed`
    // alone would leave the member on the *unfiltered* cached roster with
    // "Austin" still in the City box — a list labelled by a filter it is not
    // under. Retyping is the cheaper loss; see the comment on that handler.
    const user = userEvent.setup();
    baseRead.data = ALUMNI;
    filteredRead.data = ALUMNI;
    filteredRead.isPlaceholderData = true;

    const { rerender } = render(<AlumniDirectory />);

    await applyFilters(user);

    mockOffline.value = true;
    rerender(<AlumniDirectory />);
    await user.click(screen.getByRole("button", { name: /retry now/i }));

    expect(screen.getByLabelText("Graduation year")).toHaveValue("");
    expect(screen.getByLabelText("City")).toHaveValue("");
    expect(screen.getByLabelText("Company")).toHaveValue("");
  });
});
