import { AiReportSweepService } from './ai-report-sweep.service';

describe('AiReportSweepService', () => {
  it('deletes what has run out, at the time it runs', async () => {
    const reports = { sweep: jest.fn(async () => 3) };
    const worker = new AiReportSweepService(reports as never);
    const now = new Date('2026-12-12T10:00:00.000Z');
    await expect(worker.sweep(now)).resolves.toBe(3);
    expect(reports.sweep).toHaveBeenCalledWith(now);
  });
});
