import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ASSIGNMENT_TYPES,
  DOCUMENT_VARIANTS,
  SEMESTERS,
  backworkCourseCode,
  backworkFileTitle,
  backworkTerm,
  findDepartmentByCode,
} from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type {
  BackworkCourse,
  BackworkDepartment,
  BackworkProfessor,
  BackworkResource,
} from '#domain/entities/backwork.entity';
import { BackworkService } from '../../../backwork.service';
import { SearchService } from '../../../search.service';
import type {
  AgentReadTool,
  AgentSource,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  listSourceId,
  liveSource,
  nothing,
  quoted,
  wordsArg,
} from './chapter-tool-kit';

/** Files handed over as their own sources, so each can be cited and downloaded. */
export const BACKWORK_FILES_SHOWN = 12;
/** The most the search function ranks in one call (`search_backwork_resources`). */
const SEARCH_CAP = 50;
/**
 * The most rows one list read returns: PostgREST's `max_rows`
 * (`supabase/config.toml`). A read that fills it may have been cut, so a
 * count from it is "at least".
 */
const LIST_CAP = 1000;
/** Departments named when the one asked for is not in the library. */
const DEPARTMENTS_NAMED = 20;

const input = z.object({
  query: wordsArg(
    'Words to find files by: a course ("CSCI 1200"), its name or a nickname ("calc 1", "data structures"), a professor, or words in a title. Leave empty to count or list by the fields below alone.',
  ),
  department: wordsArg(
    'A department code, "CSCI", to read every file in one department. Leave empty for all.',
    20,
  ),
  type: z
    .enum(['', ...ASSIGNMENT_TYPES])
    .default('')
    .describe(
      'Only files of this type, as the library spells it: "Midterm", "Final Exam", "Quiz". Leave empty for any.',
    ),
  semester: z
    .enum(['', ...SEMESTERS])
    .default('')
    .describe(
      'Only files from this semester: "Fall", "Spring". Leave empty for any.',
    ),
  year: z
    .string()
    .trim()
    .regex(/^(\d{4})?$/, 'Use a four-digit year, or leave it empty.')
    .default('')
    .describe('Only files from this year, "2025". Leave empty for any.'),
  copy: z
    .enum(['', ...DOCUMENT_VARIANTS])
    .default('')
    .describe(
      'Only this kind of copy: "Blank Copy", "Answer Key", "Student Copy". Leave empty for any.',
    ),
});
type Args = z.infer<typeof input>;

interface Catalog {
  departments: Map<string, BackworkDepartment>;
  professors: Map<string, BackworkProfessor>;
  courses: Map<string, BackworkCourse>;
}

const courseKey = (departmentId: string, courseNumber: string) =>
  `${departmentId}:${courseNumber.trim().toLowerCase()}`;

/** "CSCI 1200", "CSCI", "1200", or null. */
function courseCode(resource: BackworkResource, catalog: Catalog) {
  const department = resource.department_id
    ? catalog.departments.get(resource.department_id)
    : undefined;
  return backworkCourseCode(department?.code, resource.course_number);
}

/**
 * One file's catalog entry as the model reads it: what a row on `/backwork`
 * shows, never the file. Member-written words (the title, the course's name,
 * the professor) are quoted so they cannot pass for the facts around them.
 */
function fileSource(resource: BackworkResource, catalog: Catalog): AgentSource {
  const code = courseCode(resource, catalog);
  const department = resource.department_id
    ? catalog.departments.get(resource.department_id)
    : undefined;
  const course =
    resource.department_id && resource.course_number?.trim()
      ? catalog.courses.get(
          courseKey(resource.department_id, resource.course_number),
        )
      : undefined;
  const courseName = course?.name ?? department?.name ?? null;
  const professor = resource.professor_id
    ? catalog.professors.get(resource.professor_id)
    : undefined;
  const when = backworkTerm(resource);
  const name = backworkFileTitle(resource, code);
  const kind = [resource.assignment_type, resource.assignment_number]
    .filter((part) => part !== null && part !== undefined)
    .join(' ');
  const lines = [
    `Backwork file ${quoted(name)}.`,
    code
      ? `Course: ${code}${courseName ? ` ${quoted(courseName)}` : ''}.`
      : 'Course: not given.',
    kind ? `Type: ${kind}.` : null,
    when ? `Term: ${when}.` : 'Term: not given.',
    professor ? `Professor: ${quoted(professor.name)}.` : null,
    resource.document_variant ? `Copy: ${resource.document_variant}.` : null,
    resource.is_redacted ? 'Names on it are blacked out.' : null,
    'The member can download it from this source.',
  ].filter((line): line is string => line !== null);
  return {
    ...liveSource({
      id: `backwork:${resource.id}`,
      kind: 'backwork',
      title: name,
      detail: [code, when].filter(Boolean).join(' · ') || null,
      page: null,
      lines,
      // Left out on purpose: only members who may browse backwork can open
      // the file, which is not the whole chapter, so a post to a channel
      // warns (`AgentSourceAudience`).
    }),
    target: { type: 'backwork', backwork_id: resource.id },
  };
}

/**
 * The backwork library's catalog (#5209, Paul 2026-11-16): which old exams,
 * quizzes and homework the chapter has, and the files themselves as
 * downloads. It reads the catalog only (course, type, term, professor, copy,
 * whether names are blacked out), never a file: nothing here touches
 * storage, so no file's bytes or words can reach the model. The download is
 * the client's, through `GET /v1/backwork/:id`'s signed link, when the
 * member taps the source.
 *
 * Gated like every `/v1/backwork` route: `backwork:upload` or
 * `backwork:admin`, with the backwork module on. Words go through
 * `/v1/search`'s backwork search (course names, nicknames and typos);
 * fields alone go through the library's own list.
 */
@Injectable()
export class FindBackworkAgentTool implements AgentReadTool<Args> {
  readonly name = 'find_backwork';
  readonly description =
    'The chapter\'s backwork library: old exams, quizzes, homework and notes by course, professor, type and term. Use it for "do we have old CSCI 1200 midterms?" or how many files a department has. It returns each matching file, which the member can download from the answer; it never reads what is in a file.';
  readonly permission = SystemPermissions.BACKWORK_UPLOAD;
  readonly alsoPermittedBy = [SystemPermissions.BACKWORK_ADMIN] as const;
  readonly module = 'backwork';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Looking through backwork';

  constructor(
    private readonly search: SearchService,
    private readonly backwork: BackworkService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId } = context;
    const [departments, professors, courses] = await Promise.all([
      this.backwork.getDepartments(chapterId),
      this.backwork.getProfessors(chapterId),
      this.backwork.getCourses(chapterId),
    ]);
    const catalog: Catalog = {
      departments: new Map(departments.map((d) => [d.id, d])),
      professors: new Map(professors.map((p) => [p.id, p])),
      courses: new Map(
        courses.map((c) => [courseKey(c.department_id, c.course_number), c]),
      ),
    };

    let departmentId: string | null = null;
    if (args.department) {
      const department = findDepartmentByCode(departments, args.department);
      if (!department) {
        const codes = departments
          .map((d) => d.code)
          .sort()
          .slice(0, DEPARTMENTS_NAMED);
        return nothing(
          context,
          codes.length > 0
            ? `The library has no department with that code. Its departments are ${codes.join(', ')}${departments.length > codes.length ? ', and more' : ''}.`
            : 'The library has no files yet.',
        );
      }
      departmentId = department.id;
    }
    const year = args.year ? Number(args.year) : null;
    const fits = (resource: BackworkResource) =>
      (!departmentId || resource.department_id === departmentId) &&
      (!args.type || resource.assignment_type === args.type) &&
      (!args.semester || resource.semester === args.semester) &&
      (!year || resource.year === year) &&
      (!args.copy || resource.document_variant === args.copy);

    let matched: BackworkResource[];
    let capped = false;
    if (args.query) {
      const hits = await this.search.searchBackwork(
        chapterId,
        userId,
        args.query,
        SEARCH_CAP,
      );
      capped = hits.length >= SEARCH_CAP;
      // The search ranks words only; the fields narrow its closest 50. When
      // it was cut there may be more past them, so nothing here is not none.
      matched = hits.filter(fits);
    } else {
      const listed = await this.backwork.findByChapter(chapterId, {
        department_id: departmentId ?? undefined,
        assignment_type: args.type || undefined,
        semester: args.semester || undefined,
        year: year ?? undefined,
        document_variant: args.copy || undefined,
      });
      capped = listed.length >= LIST_CAP;
      matched = listed.filter(fits);
    }

    if (matched.length === 0) {
      return nothing(
        context,
        capped
          ? `More than ${SEARCH_CAP} files match those words, and none of the closest ${SEARCH_CAP} have the other details asked for. There may still be some: do not say the library has none. Search again with fewer, more exact words, such as the course alone with the type.`
          : 'No backwork file in the library matches.',
      );
    }

    const shown = matched.slice(0, BACKWORK_FILES_SHOWN);
    const total = capped ? `At least ${matched.length}` : `${matched.length}`;
    const byType = new Map<string, number>();
    for (const resource of matched) {
      const type = resource.assignment_type ?? 'No type given';
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    const summary = liveSource({
      id: listSourceId(
        this.name,
        args.query,
        args.department,
        args.type,
        args.semester,
        args.year,
        args.copy,
      ),
      kind: 'backwork',
      title: 'Backwork',
      page: null,
      lines: [
        `${total} backwork ${matched.length === 1 && !capped ? 'file matches' : 'files match'}.`,
        `By type: ${[...byType]
          .sort((a, b) => b[1] - a[1])
          .map(([type, n]) => `${type} ${n}`)
          .join(', ')}.`,
        shown.length < matched.length
          ? `The ${count(shown.length, 'best match', 'best matches')} follow as their own sources.`
          : null,
      ].filter((line): line is string => line !== null),
    });
    return {
      chapterId,
      sources: [
        ...shown.map((resource) => fileSource(resource, catalog)),
        summary,
      ],
      entities: [],
      note:
        shown.length < matched.length
          ? `Showing ${shown.length} of ${matched.length} files. To narrow it, ask again with a type, a term or a professor.`
          : null,
      leftOutMessages: 0,
    };
  }
}
