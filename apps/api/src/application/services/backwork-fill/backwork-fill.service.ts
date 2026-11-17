import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DOCUMENT_TEXT_EXTRACT_MAX_BYTES,
  DOCUMENT_TEXT_EXTRACTOR,
  type IDocumentTextExtractor,
} from '#domain/adapters/document-text-extractor.interface';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import type { BackworkResource } from '#domain/entities/backwork.entity';
import {
  BACKWORK_FILL_PROMPT_VERSION,
  BackworkFillOutputSchema,
  backworkFillMessages,
  backworkFillSystem,
  backworkDraftHasEmptyFields,
  backworkFillText,
  checkBackworkFill,
} from '#domain/utils/backwork-fill';
import { AiConsentService } from '../ai/ai-consent.service';
import { aiConsentRefusal } from '../ai/ai-consent-refusal';
import { AiGatewayService } from '../ai/ai-gateway.service';
import { AI_FILL_CLAIM_STALE_MS, BackworkService } from '../backwork.service';

const TASK = 'backwork.fill';

/**
 * How long one fill may hold its draft's claim before it gives up: a minute
 * under `AI_FILL_CLAIM_STALE_MS`, after which another request may take the
 * claim over. Without it a fill could outlive its claim (the provider client
 * waits up to ten minutes per attempt and retries twice, and the only other
 * stop is the member leaving the page), so a takeover would read and write
 * the draft beside a fill that is still running.
 */
export const AI_FILL_TIME_LIMIT_MS = AI_FILL_CLAIM_STALE_MS - 60_000;

/**
 * The signal a claimed fill runs under: aborted when the member leaves the
 * page (`outer`) or when `limitMs` has passed since the claim, whichever
 * comes first.
 */
export function boundedFillSignal(
  outer: AbortSignal | undefined,
  limitMs: number = AI_FILL_TIME_LIMIT_MS,
): AbortSignal {
  const deadline = AbortSignal.timeout(limitMs);
  return outer ? AbortSignal.any([outer, deadline]) : deadline;
}

/**
 * How one fill ended:
 *
 * - `filled`, `nothing_found`, `unreadable`: the draft says so too
 *   (`draft_fields.ai_fill`), and `draft` is the draft as it now stands.
 * - `not_redacted`: the draft was uploaded as-is, so its stored file is the
 *   original, which no model may read; unchanged, and no call is made.
 * - `not_checked`: saved with suggested boxes the uploader has not looked at
 *   yet (#5252), so a missed name could still be on it; unchanged, no call.
 * - `refused`: the provider declined; the draft is unchanged.
 * - `unavailable`: AI is off here or a spend cap is reached; unchanged.
 * - `invalid_output`: the model's answer did not fit; unchanged, try again.
 */
export type BackworkFillResult =
  | {
      status: 'filled' | 'nothing_found' | 'unreadable';
      filled: string[];
      draft: BackworkResource;
    }
  | {
      status:
        | 'not_redacted'
        | 'not_checked'
        | 'refused'
        | 'unavailable'
        | 'invalid_output';
      reason?: string;
    };

/**
 * The upload-time backwork fill (#5233, `spec/behavior/backwork.md` § AI
 * fill). Separate from Frapp AI (Paul, 2026-11-16): it reads one draft's
 * redacted text for its uploader, proposes fields, and the uploader checks
 * every one before anything is filed. Ask never reads backwork files.
 *
 * Steps, in order:
 * 1. Consent: the chapter's Frapp AI switch and the uploader's own Yes,
 *    checked before the file is read, so a member who said No costs nothing.
 * 2. The draft: the caller's own only. One uploaded as-is is refused, since
 *    its stored file is the original; one with every field already set is
 *    marked `nothing_found` without reading its file, and one already marked
 *    `unreadable` is answered as it stands, since its file can't have
 *    changed: only the check that comes before any fill swaps a draft's file
 *    (`BackworkService.checkDraft`), so the uploader fills it by hand or
 *    deletes it and uploads a smaller or text-based copy.
 * 3. The redacted file's text layer, which holds only the words outside its
 *    redaction boxes, read by one fill at a time per draft (a second request
 *    while one runs is refused, 409). A file over the extractor's size cap is
 *    marked `unreadable` from its stored size, without being downloaded; one
 *    with too little text (a scan) is marked `unreadable` without a model
 *    call.
 * 4. One structured call, given the chapter's departments, courses and
 *    professors so it can use their spelling.
 * 5. The answer is checked (`checkBackworkFill`) and put on the draft, never
 *    over a field the uploader set.
 */
@Injectable()
export class BackworkFillService {
  constructor(
    private readonly backwork: BackworkService,
    private readonly gateway: AiGatewayService,
    private readonly consent: AiConsentService,
    @Inject(DOCUMENT_TEXT_EXTRACTOR)
    private readonly extractor: IDocumentTextExtractor,
  ) {}

  async fill(input: {
    chapterId: string;
    userId: string;
    draftId: string;
    now?: Date;
    signal?: AbortSignal;
  }): Promise<BackworkFillResult> {
    const { chapterId, userId, draftId } = input;
    const currentYear = (input.now ?? new Date()).getUTCFullYear();

    // 1.
    const entry = aiCatalogEntry(TASK);
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: BACKWORK_FILL_PROMPT_VERSION,
    });
    if (!decision.allowed) throw aiConsentRefusal(decision.reason);

    // 2.
    const draft = await this.backwork.findOwnDraft(draftId, chapterId, userId);
    if (!draft) throw new NotFoundException('Draft not found');
    if (!draft.is_redacted) return { status: 'not_redacted' };
    if (draft.draft_fields?.pages_unchecked) return { status: 'not_checked' };
    if (draft.draft_fields?.ai_fill === 'unreadable') {
      return { status: 'unreadable', filled: [], draft };
    }
    if (!backworkDraftHasEmptyFields(draft.draft_fields ?? {})) {
      return this.record(chapterId, userId, draftId, 'nothing_found', {}, []);
    }

    // 3.
    const release = await this.backwork.claimAiFill(
      draftId,
      chapterId,
      userId,
      input.now,
    );
    if (!release) {
      throw new ConflictException(
        'This draft is already being filled in. Wait a moment and look again.',
      );
    }
    try {
      return await this.readAndFill(
        draft,
        { ...input, signal: boundedFillSignal(input.signal) },
        currentYear,
      );
    } finally {
      await release();
    }
  }

  /**
   * Steps 3 to 5, while this request holds the draft's fill claim. `signal`
   * is bounded by {@link AI_FILL_TIME_LIMIT_MS}: it stops the model call, and
   * a fill past it writes nothing, so a request that has since taken the
   * claim over is never written over.
   */
  private async readAndFill(
    draft: BackworkResource,
    input: { chapterId: string; userId: string; signal: AbortSignal },
    currentYear: number,
  ): Promise<BackworkFillResult> {
    const { chapterId, userId } = input;
    const draftId = draft.id;
    const stored = await this.backwork.redactedDraftFile(
      draft,
      DOCUMENT_TEXT_EXTRACT_MAX_BYTES,
    );
    if (!stored) throw new NotFoundException('Draft not found');
    if (stored === 'too_large') {
      return this.record(chapterId, userId, draftId, 'unreadable', {}, []);
    }
    const extracted = await this.extractor.extract({
      bytes: stored.bytes,
      contentType: 'application/pdf',
      fileName: 'backwork.pdf',
    });
    const text =
      extracted.status === 'ok' ? backworkFillText(extracted.sections) : '';
    if (!text) {
      return this.record(chapterId, userId, draftId, 'unreadable', {}, []);
    }

    // 4.
    const [departments, courses, professors] = await Promise.all([
      this.backwork.getDepartments(chapterId),
      this.backwork.getCourses(chapterId),
      this.backwork.getProfessors(chapterId),
    ]);
    const taxonomy = { departments, courses, professors };
    const generated = await this.gateway.generateObject(
      TASK,
      {
        promptVersion: BACKWORK_FILL_PROMPT_VERSION,
        system: backworkFillSystem(taxonomy, currentYear),
        messages: backworkFillMessages(text),
        schema: BackworkFillOutputSchema,
        signal: input.signal,
      },
      { chapterId, actingUserId: userId },
    );
    if (generated.status === 'unavailable') {
      return {
        status: 'unavailable',
        reason: generated.detail ?? generated.reason,
      };
    }
    if (generated.status === 'refused') return { status: 'refused' };
    if (generated.status === 'invalid_output') {
      return { status: 'invalid_output' };
    }

    // 5. Not past the time limit: the claim may be another request's by now.
    input.signal.throwIfAborted();
    const checked = checkBackworkFill(generated.value, {
      draft: draft.draft_fields ?? {},
      isRedacted: draft.is_redacted,
      taxonomy,
      currentYear,
    });
    return this.record(
      chapterId,
      userId,
      draftId,
      checked.filled.length > 0 ? 'filled' : 'nothing_found',
      checked.fields,
      checked.filled,
    );
  }

  private async record(
    chapterId: string,
    userId: string,
    draftId: string,
    outcome: 'filled' | 'nothing_found' | 'unreadable',
    fields: Parameters<BackworkService['applyAiFill']>[3]['fields'],
    proposed: string[],
  ): Promise<BackworkFillResult> {
    const draft = await this.backwork.applyAiFill(draftId, chapterId, userId, {
      fields,
      outcome,
    });
    // Published or deleted while the model ran.
    if (!draft) throw new NotFoundException('Draft not found');
    const kept = new Set(draft.draft_fields?.ai_filled ?? []);
    return {
      status: outcome,
      filled: proposed.filter((key) => kept.has(key)),
      draft,
    };
  }
}
