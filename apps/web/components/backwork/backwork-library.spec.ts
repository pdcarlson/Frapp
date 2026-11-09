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
import { highlightRuns } from "@/lib/search/fuzzy-match";

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
    storage_path: "chapter/r.pdf",
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

describe("course names and nicknames (#3848)", () => {
  const math = { id: "d-math", code: "MATH", name: "Mathematics" };
  const chem = { id: "d-chem", code: "CHEM", name: "Chemistry" };
  const courses = [
    {
      id: "c-calc1",
      department_id: "d-math",
      course_number: "1010",
      course_key: "1010",
      name: "Calculus I",
      nicknames: [],
    },
    {
      id: "c-orgo",
      department_id: "d-chem",
      course_number: "2250",
      course_key: "2250",
      name: "Organic Chemistry I",
      nicknames: ["Orgo"],
    },
  ];
  const library = [
    resource({
      id: "calc2-mid",
      title: "Calculus II — Midterm 1",
      department_id: "d-math",
      course_number: "1020",
      assignment_type: "Midterm",
      assignment_number: 1,
      year: 2026,
      semester: "Spring",
    }),
    resource({
      id: "calc1-final",
      title: "Final Exam",
      department_id: "d-math",
      // Stored with stray case and spaces; still joins course "1010".
      course_number: " 1010 ",
      assignment_type: "Final Exam",
      year: 2025,
      semester: "Fall",
    }),
    resource({
      id: "orgo-quiz",
      title: "Quiz 3",
      department_id: "d-chem",
      course_number: "2250",
      assignment_type: "Quiz",
      assignment_number: 3,
    }),
    resource({
      id: "chem-lab",
      title: "Lab report",
      department_id: "d-chem",
      course_number: "1100",
      assignment_type: "Lab",
    }),
  ];
  const rows = toLibraryRows(library, [math, chem], [], courses);
  const ids = (query: string) =>
    queryLibrary(rows, query, NO_FILTERS).map((r) => r.item.resource.id);

  it("puts the course named by 'Calc 1' above a file that only shares words with it", () => {
    // Before course names, "calc 1" found only Calculus II's midterm: "calc"
    // by its title, "1" by its assignment number.
    expect(ids("Calc 1")[0]).toBe("calc1-final");
    expect(ids("Calc 1")).toEqual(["calc1-final", "calc2-mid"]);
  });

  it("treats Roman and Arabic numerals as one", () => {
    for (const query of ["Calc 1", "Calc I", "Calculus 1", "Calculus I"]) {
      expect(ids(query)[0]).toBe("calc1-final");
    }
  });

  it("does not let a lone 'i' match every file", () => {
    expect(ids("i")).not.toContain("chem-lab");
  });

  it("finds a file by a nickname, and reports the nickname", () => {
    const results = queryLibrary(rows, "orgo", NO_FILTERS);
    expect(results.map((r) => r.item.resource.id)).toEqual(["orgo-quiz"]);
    expect(results[0]?.nickname).toBe("Orgo");
  });

  it("reports no nickname when the name matched as well", () => {
    const results = queryLibrary(rows, "organic", NO_FILTERS);
    expect(results[0]?.item.resource.id).toBe("orgo-quiz");
    expect(results[0]?.nickname).toBeNull();
  });

  it("forgives a typo in a course name", () => {
    expect(ids("calculsu")).toContain("calc1-final");
  });

  it("labels a course by its name, else its department's", () => {
    const byId = new Map(rows.map((row) => [row.resource.id, row]));
    expect(byId.get("calc1-final")?.courseLabel).toBe("Calculus I");
    expect(byId.get("calc2-mid")?.courseLabel).toBe("Mathematics");
    expect(searchText(byId.get("orgo-quiz")!)).toContain("Orgo");
  });

  it("labels the Course filter option with the course name when there is one", () => {
    const options = filterOptions(rows).course;
    expect(options).toContainEqual({ value: "MATH 1010", label: "MATH 1010 · Calculus I" });
    expect(options).toContainEqual({ value: "MATH 1020", label: "MATH 1020 · Mathematics" });
  });
});

describe("numbers in course names (#3848 review)", () => {
  const math = { id: "d-math", code: "MATH", name: "Mathematics" };
  const course = (id: string, number: string, name: string, nicknames: string[] = []) => ({
    id,
    department_id: "d-math",
    course_number: number,
    course_key: number,
    name,
    nicknames,
  });
  const file = (id: string, number: string, overrides: Partial<BackworkResource> = {}) =>
    resource({ id, department_id: "d-math", course_number: number, ...overrides });

  it("'hw 1' ranks another course's Homework 1 first and leaves Calculus I's Homework 5 out", () => {
    const rows = toLibraryRows(
      [
        file("calc1-hw5", "1010", {
          title: "Homework 5",
          assignment_type: "Homework",
          assignment_number: 5,
        }),
        file("stats-hw1", "2200", {
          title: "Homework 1",
          assignment_type: "Homework",
          assignment_number: 1,
        }),
      ],
      [math],
      [],
      [course("c1", "1010", "Calculus I")],
    );
    const ids = queryLibrary(rows, "hw 1", NO_FILTERS).map((r) => r.item.resource.id);
    expect(ids).toEqual(["stats-hw1"]);
  });

  it("a bare number never reaches a file through its course name", () => {
    const rows = toLibraryRows(
      [file("calc1-final", "1010", { title: "Final" })],
      [math],
      [],
      [course("c1", "1010", "Calculus I")],
    );
    expect(queryLibrary(rows, "1", NO_FILTERS)).toEqual([]);
    expect(queryLibrary(rows, "i", NO_FILTERS)).toEqual([]);
  });

  describe("Calculus I, II and III", () => {
    const rows = toLibraryRows(
      [
        file("one", "1010", { title: "Final" }),
        file("two", "1020", { title: "Final" }),
        file("three", "1030", { title: "Final" }),
      ],
      [math],
      [],
      [
        course("c1", "1010", "Calculus I"),
        course("c2", "1020", "Calculus II", ["Calc 2"]),
        course("c3", "1030", "Calculus III"),
      ],
    );
    const results = (query: string) => queryLibrary(rows, query, NO_FILTERS);

    it("gives the course bonus only to the exact numeral", () => {
      for (const [query, first] of [
        ["Calc I", "one"],
        ["Calc 1", "one"],
        ["Calc II", "two"],
        ["Calc 2", "two"],
        ["Calculus 3", "three"],
        ["Calc III", "three"],
      ] as const) {
        const found = results(query);
        expect(found[0]?.item.resource.id).toBe(first);
        // "I" does not prefix "II": the others lack the numeral and so the
        // bonus for it, and don't match at all.
        expect(found).toHaveLength(1);
      }
    });

    it("returns the course words it matched, as written, for highlighting", () => {
      expect(results("Calc 1")[0]?.courseHits.sort()).toEqual(["calculus", "i"]);
    });

    it("reports a nickname only when it beat the name", () => {
      // "calc 2": the nickname matches both words exactly, the name too
      // ("calc" prefixes "calculus", "2" is "ii"); a tie shows no nickname.
      expect(results("Calc 2")[0]?.nickname).toBeNull();
    });
  });
});

describe("roman numerals in the query (#3848 second review)", () => {
  const math = { id: "d-math", code: "MATH", name: "Mathematics" };
  const rows = toLibraryRows(
    [
      resource({ id: "calc1-final", title: "Final", department_id: "d-math", course_number: "1010" }),
      resource({
        id: "calc2-hw5",
        title: "Homework 5",
        department_id: "d-math",
        course_number: "1020",
        assignment_type: "Homework",
        assignment_number: 5,
      }),
    ],
    [math],
    [],
    [
      {
        id: "c1",
        department_id: "d-math",
        course_number: "1010",
        course_key: "1010",
        name: "Calculus I",
        nicknames: [],
      },
      {
        id: "c2",
        department_id: "d-math",
        course_number: "1020",
        course_key: "1020",
        name: "Calculus II",
        nicknames: ["Integral Calculus"],
      },
    ],
  );
  const ids = (query: string) => queryLibrary(rows, query, NO_FILTERS).map((r) => r.item.resource.id);

  it("'calc i' finds only Calculus I: 'i' neither prefixes 'ii' nor 'integral'", () => {
    expect(ids("calc i")).toEqual(["calc1-final"]);
  });

  it("'hw i' and a bare 'i' find nothing through a course name", () => {
    expect(ids("hw i")).toEqual([]);
    expect(ids("i")).toEqual([]);
  });

  it("still lets 'i' match a title word as before (prefix included)", () => {
    const titled = toLibraryRows(
      [resource({ id: "intro", title: "Intro notes" }), resource({ id: "i-am", title: "I am notes" })],
      [],
      [],
    );
    expect(queryLibrary(titled, "i", NO_FILTERS).map((r) => r.item.resource.id).sort()).toEqual([
      "i-am",
      "intro",
    ]);
  });
});

describe("highlights for a numeral matched through the course (#3848 third review)", () => {
  it("'calc 1' lights the course name's 'I', never the title's", () => {
    const rows = toLibraryRows(
      [resource({ id: "ps1", title: "Problem Set I", department_id: "d-math", course_number: "1010" })],
      [{ id: "d-math", code: "MATH", name: "Mathematics" }],
      [],
      [
        {
          id: "c1",
          department_id: "d-math",
          course_number: "1010",
          course_key: "1010",
          name: "Calculus I",
          nicknames: [],
        },
      ],
    );
    const [result] = queryLibrary(rows, "calc 1", NO_FILTERS);
    expect(result?.item.resource.id).toBe("ps1");
    expect(result?.hits).not.toContain("i");
    expect(highlightRuns("Problem Set I", result!.hits).some((run) => run.hit)).toBe(false);
    expect(result?.courseHits).toContain("i");
  });
});
