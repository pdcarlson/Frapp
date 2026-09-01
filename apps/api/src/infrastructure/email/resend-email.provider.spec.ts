import { ResendEmailProvider } from './resend-email.provider';

describe('ResendEmailProvider', () => {
  const params = {
    to: 'member@example.com',
    joinUrl: 'https://app.frapp.live/join?token=abc',
    role: 'Member',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends via the Resend API and reports success on a 2xx response', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Frapp <invites@frapp.live>',
    });

    const result = await provider.sendInviteEmail(params);

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test',
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.from).toBe('Frapp <invites@frapp.live>');
    expect(body.to).toBe(params.to);
    expect(body.html).toContain(params.joinUrl);
  });

  it('reports failure on a non-2xx response without throwing', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(null, { status: 422, statusText: 'Unprocessable' }),
      );

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Frapp <invites@frapp.live>',
    });

    const result = await provider.sendInviteEmail(params);

    expect(result).toBe(false);
  });

  it('reports failure and swallows a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Frapp <invites@frapp.live>',
    });

    await expect(provider.sendInviteEmail(params)).resolves.toBe(false);
  });

  it('escapes HTML in the role name', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));

    const provider = new ResendEmailProvider({
      apiKey: 're_test',
      fromAddress: 'Frapp <invites@frapp.live>',
    });

    await provider.sendInviteEmail({
      ...params,
      role: '<script>alert(1)</script>',
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&lt;script&gt;');
  });
});
