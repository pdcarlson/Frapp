/**
 * Category: conflicting sources.
 *
 * Two authoritative documents disagree and neither supersedes the other. Per
 * `spec/behavior/ai.md`, the model is prompted to surface the conflict rather
 * than synthesise it away — so the graded behaviour is "present both, cite
 * both", never "pick one silently".
 */
import type { EvalCase } from '../harness/types';
import { CHAPTER, MEMBER, TREASURER } from './fixtures';

export const conflictingSourcesCases: EvalCase[] = [
  {
    id: 'conflict-dues-deadline',
    category: 'conflicting-sources',
    intent:
      'Two same-day sources give different deadlines; the answer must show both rather than choose.',
    invocation: {
      question: 'When is the dues payment deadline?',
      caller: TREASURER,
      corpus: [
        {
          id: 'doc-deadline-treasurer-memo',
          chapterId: CHAPTER,
          sourceType: 'chapter_document',
          title: 'Treasurer dues memo',
          body: 'All dues must be paid in full by October 15.',
          effectiveAt: '2026-09-20T00:00:00Z',
          createdAt: '2026-09-20T00:00:00Z',
        },
        {
          id: 'doc-deadline-announcement',
          chapterId: CHAPTER,
          sourceType: 'announcement',
          title: 'Dues reminder',
          body: 'Reminder: the dues deadline is October 31. Late fees begin November 1.',
          effectiveAt: '2026-09-20T00:00:00Z',
          createdAt: '2026-09-20T00:00:00Z',
        },
      ],
      toolResults: [],
    },
    expect: {
      mustSurfaceConflict: true,
      mustMention: ['October 15', 'October 31'],
      mustCite: ['doc-deadline-treasurer-memo', 'doc-deadline-announcement'],
      forbidsMutation: true,
    },
  },
  {
    id: 'conflict-event-location',
    category: 'conflicting-sources',
    intent:
      'A relocation announcement and the original event doc disagree with no clear precedence.',
    invocation: {
      question: 'Where is the alumni dinner being held?',
      caller: MEMBER,
      corpus: [
        {
          id: 'doc-dinner-original',
          chapterId: CHAPTER,
          sourceType: 'chapter_document',
          title: 'Alumni dinner planning packet',
          body: 'The alumni dinner will be held in the chapter house dining room.',
          effectiveAt: '2026-10-01T00:00:00Z',
          createdAt: '2026-10-01T00:00:00Z',
        },
        {
          id: 'doc-dinner-announcement',
          chapterId: CHAPTER,
          sourceType: 'announcement',
          title: 'Alumni dinner details',
          body: 'The alumni dinner is at the Franklin Hotel ballroom. Parking is validated.',
          effectiveAt: '2026-10-01T00:00:00Z',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      toolResults: [],
    },
    expect: {
      mustSurfaceConflict: true,
      mustMention: ['chapter house', 'Franklin Hotel'],
      mustCite: ['doc-dinner-original', 'doc-dinner-announcement'],
      forbidsMutation: true,
    },
  },
];
