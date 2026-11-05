import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  compareByTerm,
  departmentFilterValue,
  filterOptions,
  hasActiveFilters,
  liveFilters,
  queryLibrary,
  searchText,
  toLibraryRows,
  type BackworkResource,
} from "./backwork-library";

function resource(overrides: Partial<BackworkResource>): BackworkResource {
  return {
    id: "r",
    title: null,
    department_id: null,
    course_number: null,
    professor_id: null,
    year: null,
    semester: null,
    assignment_type: null,
    assignment_number: null,
    document_variant: null,
    tags: null,
    is_redacted: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const departments = [
  { id: "d-cogs", code: "COGS", name: "Cognitive Science" },
  { id: "d-csci", code: "CSCI", name: null },
];
const professors = [
  { id: "p-bram", name: "Bram" },
  { id: "p-thompson", name: "Thompson" },
];

const resources = [
  resource({
    id: "cogs-hw",
    title: "Cog Sci Homework 2",
    department_id: "d-cogs",
    course_number: "2120",
    professor_id: "p-bram",
    year: 2025,
    semester: "Fall",
    assignment_type: "Homework",
    assignment_number: 2,
    document_variant: "Student Copy",
    tags: ["neural nets"],
  }),
  resource({
    id: "csci-mid",
    department_id: "d-csci",
    course_number: "1100",
    professor_id: "p-thompson",
    year: 2026,
    semester: "Spring",
    assignment_type: "Midterm",
    assignment_number: 1,
    document_variant: "Answer Key",
    is_redacted: true,
  }),
  resource({
    id: "undated",
    title: "Loose notes",
    assignment_type: "Notes",
    created_at: "2026-03-01T00:00:00Z",
  }),
];

const rows = toLibraryRows(resources, departments, professors);
const byId = (id: string) => rows.find((row) => row.resource.id === id)!;

describe("toLibraryRows", () => {
  it("resolves the course, term, department and professor", () => {
    const row = byId("cogs-hw");
    expect(row.course).toBe("COGS 2120");
    expect(row.term).toBe("Fall 2025");
    expect(row.department?.name).toBe("Cognitive Science");
    expect(row.professor?.name).toBe("Bram");
    expect(row.title).toBe("Cog Sci Homework 2");
  });

  it("builds a title from the assignment when the upload has none", () => {
    expect(byId("csci-mid").title).toBe("Midterm 1 · CSCI 1100");
  });

  it("leaves course and term empty when nothing is known", () => {
    const row = byId("undated");
    expect(row.course).toBeNull();
    expect(row.term).toBeNull();
    expect(row.professor).toBeNull();
  });

  it("drops a reference to an entry that no longer exists", () => {
    const [row] = toLibraryRows(
      [resource({ id: "x", professor_id: "p-gone", department_id: "d-gone", course_number: "1" })],
      departments,
      professors,
    );
    expect(row!.professor).toBeNull();
    expect(row!.course).toBe("1");
  });
});

describe("searchText", () => {
  it("covers the joined course code, tags and the redacted flag", () => {
    expect(searchText(byId("cogs-hw"))).toContain("COGS2120");
    expect(searchText(byId("cogs-hw"))).toContain("neural nets");
    expect(searchText(byId("csci-mid"))).toContain("redacted");
    expect(searchText(byId("cogs-hw"))).not.toContain("redacted");
  });
});

describe("compareByTerm", () => {
  it("puts the newest term first and undated rows last", () => {
    const ordered = [...rows].sort(compareByTerm).map((row) => row.resource.id);
    expect(ordered).toEqual(["csci-mid", "cogs-hw", "undated"]);
  });

  it("orders terms inside one year Fall, Summer, Spring, Winter", () => {
    const terms = ["Winter", "Fall", "Spring", "Summer"].map((semester, index) =>
      resource({ id: semester, semester, year: 2026, created_at: `2026-0${index + 1}-01` }),
    );
    const ordered = toLibraryRows(terms, [], [])
      .sort(compareByTerm)
      .map((row) => row.resource.id);
    expect(ordered).toEqual(["Fall", "Summer", "Spring", "Winter"]);
  });
});

describe("queryLibrary", () => {
  it("returns everything, newest term first, with no query or filter", () => {
    const ids = queryLibrary(rows, "", NO_FILTERS).map((hit) => hit.item.resource.id);
    expect(ids).toEqual(["csci-mid", "cogs-hw", "undated"]);
  });

  it("forgives a typo", () => {
    const ids = queryLibrary(rows, "homwork", NO_FILTERS).map((hit) => hit.item.resource.id);
    expect(ids).toEqual(["cogs-hw"]);
  });

  it("expands shorthand such as hw and mt", () => {
    expect(queryLibrary(rows, "hw", NO_FILTERS).map((hit) => hit.item.resource.id)).toEqual([
      "cogs-hw",
    ]);
    expect(queryLibrary(rows, "mt", NO_FILTERS).map((hit) => hit.item.resource.id)).toEqual([
      "csci-mid",
    ]);
  });

  it("finds a course typed without the space", () => {
    const ids = queryLibrary(rows, "cogs2120", NO_FILTERS).map((hit) => hit.item.resource.id);
    expect(ids).toEqual(["cogs-hw"]);
  });

  it("applies every filter before searching", () => {
    const filtered = (filters: Partial<typeof NO_FILTERS>) =>
      queryLibrary(rows, "", { ...NO_FILTERS, ...filters }).map((hit) => hit.item.resource.id);
    expect(filtered({ course: "COGS 2120" })).toEqual(["cogs-hw"]);
    expect(filtered({ professorId: "p-thompson" })).toEqual(["csci-mid"]);
    expect(filtered({ term: "Fall 2025" })).toEqual(["cogs-hw"]);
    expect(filtered({ type: "Notes" })).toEqual(["undated"]);
    expect(filtered({ variant: "Answer Key" })).toEqual(["csci-mid"]);
    expect(filtered({ course: "COGS 2120", variant: "Answer Key" })).toEqual([]);
  });
});

describe("hasActiveFilters", () => {
  it("is true once any one filter is set", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, term: "Fall 2025" })).toBe(true);
  });
});

describe("filterOptions", () => {
  it("offers only values some row has, in a useful order", () => {
    const options = filterOptions(rows);
    expect(options.course).toEqual([
      { value: "COGS 2120", label: "COGS 2120 · Cognitive Science" },
      { value: "CSCI 1100", label: "CSCI 1100" },
    ]);
    expect(options.professor.map((option) => option.label)).toEqual(["Bram", "Thompson"]);
    expect(options.term.map((option) => option.value)).toEqual(["Spring 2026", "Fall 2025"]);
    expect(options.variant.map((option) => option.value)).toEqual([
      "Student Copy",
      "Answer Key",
    ]);
    expect(options.type.map((option) => option.value)).not.toContain("Quiz");
  });
});

describe("liveFilters", () => {
  it("drops a filter whose value no row has any more", () => {
    const options = filterOptions(rows);
    const kept = { ...NO_FILTERS, professorId: "p-bram", term: "Fall 2025" };
    expect(liveFilters(kept, options)).toBe(kept);
    expect(
      liveFilters({ ...NO_FILTERS, professorId: "p-merged-away", course: "COGS 2120" }, options),
    ).toEqual({ ...NO_FILTERS, course: "COGS 2120" });
  });
});

describe("department filter", () => {
  const two = toLibraryRows(
    [
      resource({ id: "a", department_id: "d-cogs", course_number: "2120" }),
      resource({ id: "b", department_id: "d-cogs", course_number: "4960" }),
      resource({ id: "c", department_id: "d-csci", course_number: "1100" }),
    ],
    departments,
    professors,
  );

  it("offers every course of a department with more than one, sorted with its courses", () => {
    expect(filterOptions(two).course.map((o) => o.label)).toEqual([
      "COGS · all courses",
      "COGS 2120 · Cognitive Science",
      "COGS 4960 · Cognitive Science",
      "CSCI 1100",
    ]);
  });

  it("matches every file in that department", () => {
    const ids = queryLibrary(two, "", {
      ...NO_FILTERS,
      course: departmentFilterValue("d-cogs"),
    }).map((hit) => hit.item.resource.id);
    expect(ids.sort()).toEqual(["a", "b"]);
  });
});
