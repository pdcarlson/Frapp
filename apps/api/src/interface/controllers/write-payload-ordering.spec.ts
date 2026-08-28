import { EventController } from './event.controller';
import { FinancialInvoiceController } from './financial-invoice.controller';
import { BackworkController } from './backwork.controller';
import type { EventService } from '../../application/services/event.service';
import type { FinancialInvoiceService } from '../../application/services/financial-invoice.service';
import type { BackworkService } from '../../application/services/backwork.service';
import type { RbacService } from '../../application/services/rbac.service';

/**
 * The spread ordering in the write controllers, pinned (#849).
 *
 * These controllers build their write payload by spreading the request DTO
 * beside server-decided keys (`chapter_id`, `created_by`, `uploader_id`). The
 * order decides who wins a collision: `{ ...dto, chapter_id }` means the server
 * always does, `{ chapter_id, ...dto }` means the client does.
 *
 * Today no DTO declares those names and `forbidNonWhitelisted` 400s any request
 * that supplies one, so the ordering is unreachable over HTTP — an e2e test
 * cannot distinguish the two orderings, because the colliding key never
 * survives the pipe to reach the controller. That makes whitelisting a single
 * point of failure unless the ordering is pinned somewhere, which is what these
 * do: they call the controller methods directly with a DTO that carries the
 * hostile key, exactly as a future DTO legitimately growing a `chapter_id`
 * property would. Flip an ordering back and these fail; the e2e suite does not.
 */
describe('Write payload ordering — server-decided keys survive a DTO collision', () => {
  const CHAPTER_ID = 'chapter-real';
  const HOSTILE_CHAPTER_ID = 'chapter-victim';
  const USER_ID = 'user-real';
  const HOSTILE_USER_ID = 'user-impersonated';

  it('EventController.create keeps the server chapter and author', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'evt-1' });
    const controller = new EventController({
      create,
    } as unknown as EventService);

    await controller.create(CHAPTER_ID, USER_ID, {
      name: 'Chapter Meeting',
      start_time: '2026-09-01T18:00:00.000Z',
      end_time: '2026-09-01T19:00:00.000Z',
      // A DTO that grew these properties, or a pipe that stopped stripping them.
      chapter_id: HOSTILE_CHAPTER_ID,
      created_by: HOSTILE_USER_ID,
    } as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: CHAPTER_ID,
        created_by: USER_ID,
      }),
    );
  });

  it('FinancialInvoiceController.create keeps the server chapter', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'inv-1' });
    const controller = new FinancialInvoiceController(
      { create } as unknown as FinancialInvoiceService,
      {} as unknown as RbacService,
    );

    await controller.create(CHAPTER_ID, {
      user_id: '33333333-3333-4333-8333-333333333333',
      title: 'Fall 2026 Dues',
      amount: 15000,
      due_date: '2026-09-01',
      chapter_id: HOSTILE_CHAPTER_ID,
    } as never);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ chapter_id: CHAPTER_ID }),
    );
  });

  it('BackworkController.confirmUpload keeps the server chapter and uploader', async () => {
    const confirmUpload = jest.fn().mockResolvedValue({ id: 'bw-1' });
    const controller = new BackworkController({
      confirmUpload,
    } as unknown as BackworkService);

    await controller.confirmUpload(CHAPTER_ID, USER_ID, {
      storage_path: `chapters/${CHAPTER_ID}/backwork/x.pdf`,
      title: 'Exam 1',
      chapter_id: HOSTILE_CHAPTER_ID,
      uploader_id: HOSTILE_USER_ID,
    } as never);

    expect(confirmUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        chapter_id: CHAPTER_ID,
        uploader_id: USER_ID,
      }),
    );
  });
});
