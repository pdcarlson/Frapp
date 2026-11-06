/**
 * The slice of `@react-native-google-signin/google-signin` (the free
 * "Original" API, pinned in package.json) that `lib/google-auth.ts` uses.
 */
export type GoogleSignInModule = {
  GoogleSignin: {
    configure: (options: { webClientId: string; iosClientId?: string }) => void;
    hasPlayServices: (options?: {
      showPlayServicesUpdateDialog: boolean;
    }) => Promise<boolean>;
    signIn: () => Promise<
      | { type: "success"; data: { idToken: string | null } }
      | { type: "cancelled"; data: null }
    >;
    signOut: () => Promise<null>;
  };
  statusCodes: {
    SIGN_IN_CANCELLED: string;
    IN_PROGRESS: string;
    PLAY_SERVICES_NOT_AVAILABLE: string;
  };
};
