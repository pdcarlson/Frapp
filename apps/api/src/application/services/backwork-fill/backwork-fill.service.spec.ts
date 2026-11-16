import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { IDocumentTextExtractor } from '#domain/adapters/document-text-extractor.interface';
import type { BackworkResource } from '#domain/entities/backwork.entity';
import type { AiConsentService } from '../ai/ai-consent.service';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import type { BackworkService } from '../backwork.service';
import { BackworkFillService } from './backwork-fill.service';

const CHAPTER = 'chapter-1';
const USER = 'user-1';
const DRAFT = 'draft-1';
const NOW = new Date('2026-11-16T12:00:00Z');

const STORED_BYTES = new Uint8Array([37, 80, 68, 70]);

function draft(
  fields: Record<string, unknown> = {},
  isRedacted = true,
): BackworkResource {
  return {
    id: DRAFT,
    chapter_id: CHAPTER,
    uploader_id: USER,
    is_redacted: isRedacted,
    storage_path: `${CHAPTER}/backwork/file.pdf`,
    draft_fields: fields,
  } as unknown as BackworkResource;
}

const PAGE_TEXT =
  'CHEM 1010 General Chemistry, Exam 2, Spring 2024. Professor Alvarez. Name: ____';

function setup(
  options: {
    allowed?: boolean;
    text?: string;
    found?: boolean;
    isRedacted?: boolean;
    generated?: unknown;
    stored?: Record<string, unknown>;
  } = {},
) {
  const stored = options.stored ?? {};
  const backwork = {
    findOwnDraft: jest.fn(async () =>
      options.found === false
        ? null
        : draft(stored, options.isRedacted ?? true),
    ),
    redactedDraftFile: jest.fn(async () => STORED_BYTES),
    getDepartments: jest.fn(async () => [
      { id: 'd1', code: 'CHEM', name: 'Chemistry' },
    ]),
    getCourses: jest.fn(async () => []),
    getProfessors: jest.fn(async () => [{ name: 'Alvarez' }]),
    applyAiFill: jest.fn(
      async (
        _id: string,
        _chapter: string,
        _user: string,
        fill: { fields: Record<string, unknown>; outcome: string },
      ) =>
        draft({
          ...stored,
          ...fill.fields,
          ai_fill: fill.outcome,
          ...(Object.keys(fill.fields).length
            ? { ai_filled: Object.keys(fill.fields) }
            : {}),
        }),
    ),
  };
  const gateway = {
    generateObject: jest.fn(
      async (..._args: unknown[]) =>
        options.generated ?? {
          status: 'ok',
          value: {
            title: 'CHEM 1010 Exam 2 (Spring 2024)',
            department_code: 'chem',
            course_number: '1010',
            professor_name: 'alvarez',
            year: 2024,
            semester: 'Spring',
            assignment_type: 'Exam',
            assignment_number: 2,
            document_variant: null,
          },
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
        },
    ),
  };
  const consent = {
    check: jest.fn(async () =>
      options.allowed === false
        ? { allowed: false, reason: 'member_declined' }
        : { allowed: true },
    ),
  };
  const extractor: IDocumentTextExtractor = {
    extract: jest.fn(async () => ({
      status: 'ok' as const,
      sections: [{ heading: null, page: 1, text: options.text ?? PAGE_TEXT }],
    })),
  };
  const service = new BackworkFillService(
    backwork as unknown as BackworkService,
    gateway as unknown as AiGatewayService,
    consent as unknown as AiConsentService,
    extractor,
  );
  const run = () =>
    service.fill({
      chapterId: CHAPTER,
      userId: USER,
      draftId: DRAFT,
      now: NOW,
    });
  return { service, backwork, gateway, consent, extractor, run };
}

describe('BackworkFillService', () => {
  it("fills the draft from its stored file's text, in the chapter's spelling", async () => {
    const { run, gateway, backwork } = setup();
    const result = await run();

    expect(result.status).toBe('filled');
    const [task, prompt, context] = gateway.generateObject.mock
      .calls[0] as unknown as [
      string,
      { messages: Array<{ content: string }>; system: string },
      unknown,
    ];
    expect(task).toBe('backwork.fill');
    expect(prompt.messages[0].content).toContain(PAGE_TEXT);
    expect(context).toEqual({ chapterId: CHAPTER, actingUserId: USER });
    const fill = backwork.applyAiFill.mock.calls[0][3];
    expect(fill.outcome).toBe('filled');
    expect(fill.fields).toMatchObject({
      department_code: 'CHEM',
      course_number: '1010',
      professor_name: 'Alvarez',
      year: 2024,
      semester: 'Spring',
      assignment_type: 'Exam',
      assignment_number: 2,
    });
  });

  it("reads the redacted draft's stored bytes, and sends the model only their text: never the file name or the draft title", async () => {
    const { run, gateway, extractor, backwork } = setup({
      stored: { title: 'Jane Doe exam 2' },
    });
    await run();
    expect(backwork.redactedDraftFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: DRAFT, is_redacted: true }),
    );
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: STORED_BYTES,
        fileName: 'backwork.pdf',
      }),
    );
    const sent = JSON.stringify(gateway.generateObject.mock.calls[0][1]);
    expect(sent).not.toContain('Jane Doe');
    expect(sent).not.toContain('file.pdf');
  });

  it('never reads a draft uploaded as-is, whose stored file is the original', async () => {
    const { run, gateway, extractor, backwork } = setup({ isRedacted: false });
    await expect(run()).resolves.toEqual({ status: 'not_redacted' });
    expect(backwork.redactedDraftFile).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(backwork.applyAiFill).not.toHaveBeenCalled();
  });

  it('never reads a folder draft before its uploader has checked the pages', async () => {
    const { run, gateway, extractor, backwork } = setup({
      stored: { pages_unchecked: true },
    });
    await expect(run()).resolves.toEqual({ status: 'not_checked' });
    expect(backwork.redactedDraftFile).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(backwork.applyAiFill).not.toHaveBeenCalled();
  });

  it('marks a draft with every field set without reading its file', async () => {
    const { run, gateway, backwork } = setup({
      stored: {
        title: 't',
        department_code: 'CHEM',
        course_number: '1010',
        professor_name: 'A',
        year: 2024,
        semester: 'Spring',
        assignment_type: 'Exam',
        assignment_number: 2,
        document_variant: 'Blank Copy',
      },
    });
    await expect(run()).resolves.toMatchObject({ status: 'nothing_found' });
    expect(backwork.redactedDraftFile).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('marks a file with no readable text without calling the model', async () => {
    const { run, gateway, backwork } = setup({ text: '  ' });
    const result = await run();
    expect(result.status).toBe('unreadable');
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(backwork.applyAiFill.mock.calls[0][3]).toEqual({
      fields: {},
      outcome: 'unreadable',
    });
  });

  it('refuses before reading the file when the member has not said yes', async () => {
    const { run, backwork } = setup({ allowed: false });
    await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
    expect(backwork.findOwnDraft).not.toHaveBeenCalled();
  });

  it("is a 404 for a draft that isn't the caller's", async () => {
    const { run, gateway } = setup({ found: false });
    await expect(run()).rejects.toBeInstanceOf(NotFoundException);
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'refused', category: null }, 'refused'],
    [{ status: 'invalid_output' }, 'invalid_output'],
    [
      { status: 'unavailable', reason: 'spend_cap', detail: 'member_cap' },
      'unavailable',
    ],
  ])(
    'leaves the draft unchanged when the model answers %o',
    async (generated, status) => {
      const { run, backwork } = setup({ generated });
      const result = await run();
      expect(result.status).toBe(status);
      expect(backwork.applyAiFill).not.toHaveBeenCalled();
    },
  );

  it('says nothing was found when every proposal is already set', async () => {
    const { run, backwork } = setup({
      stored: {
        title: 't',
        department_code: 'CHEM',
        course_number: '1010',
        professor_name: 'Alvarez',
        year: 2024,
        semester: 'Spring',
        assignment_type: 'Exam',
        assignment_number: 2,
      },
    });
    const result = await run();
    expect(result.status).toBe('nothing_found');
    expect(backwork.applyAiFill.mock.calls[0][3].fields).toEqual({});
  });
});
