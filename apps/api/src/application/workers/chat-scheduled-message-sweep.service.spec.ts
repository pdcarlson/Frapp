import { ChatScheduledMessageSweepService } from './chat-scheduled-message-sweep.service';
import type { ChatScheduledMessageService } from '../services/chat-scheduled-message.service';
import type { IChatScheduledMessageRepository } from '#domain/repositories/chat-scheduled-message.repository.interface';
import type { ChatScheduledMessage } from '#domain/entities/chat-scheduled-message.entity';

const NOW = Date.parse('2026-11-14T13:00:00.000Z');

const row = (id: string, attempts = 0) =>
  ({ id, chapter_id: 'ch-1', attempts }) as ChatScheduledMessage;

describe('ChatScheduledMessageSweepService', () => {
  let repo: { findDue: jest.Mock; claim: jest.Mock };
  let scheduled: { deliver: jest.Mock };
  let sweep: ChatScheduledMessageSweepService;

  beforeEach(() => {
    repo = {
      findDue: jest.fn().mockResolvedValue([row('a'), row('b', 2), row('c')]),
      claim: jest.fn().mockResolvedValue(true),
    };
    scheduled = {
      deliver: jest.fn().mockResolvedValue({ outcome: 'sent', message: {} }),
    };
    sweep = new ChatScheduledMessageSweepService(
      repo as unknown as IChatScheduledMessageRepository,
      scheduled as unknown as ChatScheduledMessageService,
    );
  });

  it('reads what is due now and leases each row two minutes', async () => {
    await sweep.sweep(NOW);
    expect(repo.findDue).toHaveBeenCalledWith(new Date(NOW).toISOString(), 50);
    expect(repo.claim).toHaveBeenCalledWith(
      row('a'),
      new Date(NOW + 2 * 60 * 1000).toISOString(),
      new Date(NOW).toISOString(),
    );
  });

  it('delivers each claimed row with the attempt it just spent', async () => {
    await expect(sweep.sweep(NOW)).resolves.toEqual({
      sent: 3,
      failed: 0,
      retry: 0,
    });
    expect(scheduled.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b', attempts: 3 }),
    );
  });

  it('skips a row another replica claimed first', async () => {
    repo.claim.mockImplementation(
      async (r: ChatScheduledMessage) => r.id !== 'b',
    );
    await sweep.sweep(NOW);
    expect(scheduled.deliver).toHaveBeenCalledTimes(2);
    expect(scheduled.deliver).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    );
  });

  it('keeps going past a row whose send threw', async () => {
    scheduled.deliver
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ outcome: 'failed', reason: 'no_access' })
      .mockResolvedValueOnce({ outcome: 'retry', cause: new Error('x') });
    await expect(sweep.sweep(NOW)).resolves.toEqual({
      sent: 0,
      failed: 1,
      retry: 2,
    });
  });

  it('does not overlap itself on one replica', async () => {
    let release: () => void = () => {};
    repo.findDue.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );
    const first = sweep.handleScheduledMessageSweep();
    await sweep.handleScheduledMessageSweep();
    expect(repo.findDue).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
