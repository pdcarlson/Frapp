export type AppleAuthModule = {
  isAvailableAsync: () => Promise<boolean>;
  signInAsync: (options: {
    requestedScopes: unknown[];
    nonce?: string;
  }) => Promise<{
    identityToken: string | null;
    email: string | null;
    fullName: {
      givenName: string | null;
      familyName: string | null;
    } | null;
  }>;
  AppleAuthenticationScope: {
    FULL_NAME: unknown;
    EMAIL: unknown;
  };
};
