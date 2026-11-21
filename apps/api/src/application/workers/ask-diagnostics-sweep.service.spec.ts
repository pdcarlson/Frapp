import { AskDiagnosticsSweepService } from './ask-diagnostics-sweep.service';

describe('AskDiagnosticsSweepService', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('ends whatever has run out, even with AI switched off on the server', async () => {
    delete process.env.AI_ENABLED;
    const diagnostics = { sweep: jest.fn(async () => 1) };
    const service = new AskDiagnosticsSweepService(diagnostics as never);
    await service.handleAskDiagnosticsSweep();
    expect(diagnostics.sweep).toHaveBeenCalledTimes(1);
    expect(diagnostics.sweep.mock.calls[0]).toEqual([expect.any(Date)]);
  });
});
