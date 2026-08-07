/**
 * Category: stale information.
 *
 * Old authoritative content contradicted by newer authoritative content. The
 * agent must answer from the current source, and must not treat upload order as
 * currency — spec §13 Prerequisites notes that `chapter_documents.created_at`
 * measures upload time, not effective date.
 */
import type { EvalCase } from '../harness/types';
import { CHAPTER, MEMBER, TREASURER } from './fixtures';

export const staleInformationCases: EvalCase[] = [
  {
    id: 'stale-dues-amount',
    category: 'stale-information',
    intent:
      'A newer dues notice supersedes an older one; the answer must quote the current amount.',
    invocation: {
      question: 'How much are dues this semester?',
      caller: MEMBER,
      corpus: [
        {
          id: 'doc-dues-september',
          chapterId: CHAPTER,
          sourceType: 'meeting_minutes',
          title: 'September chapter meeting minutes',
          body: 'Treasurer reported dues for the term are set at $200 per active member.',
          effectiveAt: '2026-09-04T00:00:00Z',
          createdAt: '2026-09-04T00:00:00Z',
        },
        {
          id: 'doc-dues-november',
          chapterId: CHAPTER,
          sourceType: 'announcement',
          title: 'Revised dues notice',
          body: 'Effective immediately, dues for the term are $225 per active member. This supersedes the September figure.',
          effectiveAt: '2026-11-02T00:00:00Z',
          createdAt: '2026-11-02T00:00:00Z',
        },
      ],
      toolResults: [],
    },
    expect: {
      mustMention: ['$225'],
      mustCite: ['doc-dues-november'],
      forbidsMutation: true,
    },
  },
  {
    id: 'stale-officer-roster',
    category: 'stale-information',
    intent:
      'Roster is live structured data read through a tool; embedded minutes naming a former officer must not win.',
    invocation: {
      question: 'Who is the chapter treasurer right now?',
      caller: MEMBER,
      corpus: [
        {
          id: 'doc-elections-minutes',
          chapterId: CHAPTER,
          sourceType: 'meeting_minutes',
          title: 'Spring elections minutes',
          body: 'Marcus Webb was elected treasurer for the spring term.',
          effectiveAt: '2026-01-20T00:00:00Z',
          createdAt: '2026-01-20T00:00:00Z',
        },
      ],
      toolResults: [
        {
          toolName: 'get_officer_roster',
          chapterId: CHAPTER,
          content: 'Treasurer: Dana Ruiz (since 2026-06-01). President: Sam Ito.',
        },
      ],
    },
    expect: {
      mustMention: ['Dana Ruiz'],
      mustNotMention: ['Marcus Webb'],
      forbidsMutation: true,
    },
  },
  {
    id: 'stale-superseded-bylaw',
    category: 'stale-information',
    intent:
      'An amendment uploaded before the original it supersedes must still win on effective date.',
    invocation: {
      question: 'What is the quorum for a chapter vote?',
      caller: TREASURER,
      corpus: [
        {
          id: 'doc-bylaws-amendment',
          chapterId: CHAPTER,
          sourceType: 'chapter_document',
          title: 'Bylaws amendment 2026-03 (Article IV quorum)',
          body: 'Article IV is amended: quorum for any chapter vote is two-thirds of active members.',
          effectiveAt: '2026-03-15T00:00:00Z',
          // Uploaded BEFORE the original below — recency by upload time is wrong here.
          createdAt: '2026-04-01T00:00:00Z',
        },
        {
          id: 'doc-bylaws-original',
          chapterId: CHAPTER,
          sourceType: 'chapter_document',
          title: 'Chapter bylaws (2019 revision)',
          body: 'Article IV: quorum for any chapter vote is a simple majority of active members.',
          effectiveAt: '2019-08-01T00:00:00Z',
          createdAt: '2026-04-20T00:00:00Z',
        },
      ],
      toolResults: [],
    },
    expect: {
      mustMention: ['two-thirds'],
      mustCite: ['doc-bylaws-amendment'],
      forbidsMutation: true,
    },
  },
];
