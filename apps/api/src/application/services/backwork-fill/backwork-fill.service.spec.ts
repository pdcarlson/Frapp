import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DOCUMENT_TEXT_EXTRACT_MAX_BYTES,
  type IDocumentTextExtractor,
} from '#domain/adapters/document-text-extractor.interface';
import type { BackworkResource } from '#domain/entities/backwork.entity';
import type { AiConsentService } from '../ai/ai-consent.service';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import {
  AI_FILL_CLAIM_STALE_MS,
  type BackworkService,
} from '../backwork.service';
import {
  AI_FILL_TIME_LIMIT_MS,
  BackworkFillService,
  boundedFillSignal,
} from './backwork-fill.service';

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
    /** What the size-checked read answers; the stored bytes by default. */
    file?: { bytes: Uint8Array } | 'too_large' | null;
    /** False when another fill already holds the draft. */
    claimed?: boolean;
  } = {},
) {
  const release = jest.fn(async () => undefined);
  const stored = options.stored ?? {};
  const backwork = {
    findOwnDraft: jest.fn(async () =>
      options.found === false
        ? null
        : draft(stored, options.isRedacted ?? true),
    ),
    redactedDraftFile: jest.fn(async () =>
      options.file === undefined ? { bytes: STORED_BYTES } : options.file,
    ),
    claimAiFill: jest.fn(async () =>
      options.claimed === false ? null : release,
    ),
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
  return { service, backwork, gateway, consent, extractor, run, release };
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
      DOCUMENT_TEXT_EXTRACT_MAX_BYTES,
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

  it('marks a file over the extractor cap unreadable from its stored size, without opening it', async () => {
    const { run, gateway, extractor, backwork, release } = setup({
      file: 'too_large',
    });
    const result = await run();
    expect(result.status).toBe('unreadable');
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(backwork.applyAiFill.mock.calls[0][3]).toEqual({
      fields: {},
      outcome: 'unreadable',
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('answers a draft already marked unreadable as it stands, without claiming or reading it', async () => {
    const { run, gateway, backwork } = setup({
      stored: { ai_fill: 'unreadable' },
    });
    await expect(run()).resolves.toMatchObject({
      status: 'unreadable',
      filled: [],
      draft: expect.objectContaining({ id: DRAFT }),
    });
    expect(backwork.claimAiFill).not.toHaveBeenCalled();
    expect(backwork.redactedDraftFile).not.toHaveBeenCalled();
    expect(backwork.applyAiFill).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('refuses a second fill of a draft while one is running', async () => {
    const { run, backwork, gateway } = setup({ claimed: false });
    await expect(run()).rejects.toBeInstanceOf(ConflictException);
    expect(backwork.claimAiFill).toHaveBeenCalledWith(
      DRAFT,
      CHAPTER,
      USER,
      NOW,
    );
    expect(backwork.redactedDraftFile).not.toHaveBeenCalled();
    expect(gateway.generateObject).not.toHaveBeenCalled();
  });

  it('releases its claim when the fill ends, and when it fails', async () => {
    const done = setup();
    await done.run();
    expect(done.release).toHaveBeenCalledTimes(1);

    const failed = setup({ file: null });
    await expect(failed.run()).rejects.toBeInstanceOf(NotFoundException);
    expect(failed.release).toHaveBeenCalledTimes(1);
  });

  describe('the time limit on a claimed fill', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** Stands in for `AbortSignal.timeout`, so a spec can make it fire. */
    function controlDeadline() {
      const deadline = new AbortController();
      const timeout = jest
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(deadline.signal);
      return { deadline, timeout };
    }

    function signalOf(gateway: { generateObject: jest.Mock }): AbortSignal {
      const prompt = gateway.generateObject.mock.calls[0][1] as {
        signal: AbortSignal;
      };
      return prompt.signal;
    }

    it('ends a minute inside the claim, so a takeover never runs beside a live fill', () => {
      expect(AI_FILL_TIME_LIMIT_MS).toBeLessThanOrEqual(
        AI_FILL_CLAIM_STALE_MS - 60_000,
      );
    });

    it('runs the model call under the time limit, starting once the claim is held', async () => {
      const { timeout } = controlDeadline();
      const { run, gateway } = setup();
      await run();
      expect(timeout).toHaveBeenCalledWith(AI_FILL_TIME_LIMIT_MS);
      expect(signalOf(gateway).aborted).toBe(false);
    });

    it('stops a model call still running at the limit, and lets the claim go', async () => {
      const { deadline } = controlDeadline();
      const { run, gateway, backwork, release } = setup();
      gateway.generateObject.mockImplementation(
        (..._args: unknown[]) =>
          new Promise((_resolve, reject) => {
            const { signal } = _args[1] as { signal: AbortSignal };
            signal.addEventListener('abort', () => reject(signal.reason));
            deadline.abort(new DOMException('limit', 'TimeoutError'));
          }),
      );
      await expect(run()).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(backwork.applyAiFill).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when the limit passed while the model answered', async () => {
      const { deadline } = controlDeadline();
      const { run, gateway, backwork, release } = setup();
      const answer = await gateway.generateObject();
      gateway.generateObject.mockImplementation(async () => {
        deadline.abort(new DOMException('limit', 'TimeoutError'));
        return answer;
      });
      await expect(run()).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(backwork.applyAiFill).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('still stops when the member leaves the page', async () => {
      const left = new AbortController();
      const { service, gateway } = setup();
      await service.fill({
        chapterId: CHAPTER,
        userId: USER,
        draftId: DRAFT,
        now: NOW,
        signal: left.signal,
      });
      const signal = signalOf(gateway);
      expect(signal.aborted).toBe(false);
      left.abort();
      expect(signal.aborted).toBe(true);
    });

    it('fires on its own once the limit passes', async () => {
      const signal = boundedFillSignal(undefined, 5);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(signal.aborted).toBe(true);
      expect((signal.reason as Error).name).toBe('TimeoutError');
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
