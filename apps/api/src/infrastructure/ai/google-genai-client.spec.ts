import { GoogleGenAI } from '@google/genai';
import { googleGenAiClient } from './google-genai-client';

jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn() }));

const constructed = (): Record<string, unknown> =>
  (GoogleGenAI as unknown as jest.Mock).mock.calls.at(-1)?.[0] as Record<
    string,
    unknown
  >;

describe('googleGenAiClient', () => {
  it('signs in with the key file when there is one', () => {
    const credentials = { type: 'service_account', client_email: 'a@b' };
    googleGenAiClient({ project: 'p', location: 'global', credentials });
    expect(constructed()).toEqual({
      enterprise: true,
      project: 'p',
      location: 'global',
      googleAuthOptions: {
        credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      },
    });
  });

  it('leaves credentials out without one, so the runtime identity signs in', () => {
    googleGenAiClient({ project: 'p', location: 'global', credentials: null });
    expect(constructed().googleAuthOptions).toEqual({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  });
});
