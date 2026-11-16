import { envSetting, parseServiceAccount } from './ai-config';

type Env = Record<string, unknown>;

/**
 * The Google service account that reads chapters' connected Drive folders
 * (#5157; `spec/behavior/chapter-docs.md` § Google Drive folder).
 *
 * `GOOGLE_DRIVE_CREDENTIALS_JSON` is the account's key file as JSON. A
 * chapter shares its folder with the account's `client_email`, and the API
 * reads only what was shared with it. Unset, Google Drive is not offered and
 * the sync worker leaves every connection as it is. Each environment has its
 * own account, so a staging chapter can never read a production folder.
 */
export interface GoogleDriveServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export function googleDriveServiceAccount(
  env: Env = process.env,
): GoogleDriveServiceAccount | null {
  const json = envSetting(env, 'GOOGLE_DRIVE_CREDENTIALS_JSON');
  if (!json) return null;
  const parsed = parseServiceAccount(json);
  if (!parsed) return null;
  return {
    clientEmail: parsed.client_email as string,
    privateKey: parsed.private_key as string,
  };
}

/** Boot-time check, called from `validateEnv`: set means a real key file. */
export function validateGoogleDriveEnv(env: Env): string[] {
  const json = envSetting(env, 'GOOGLE_DRIVE_CREDENTIALS_JSON');
  if (json && !parseServiceAccount(json)) {
    return [
      'GOOGLE_DRIVE_CREDENTIALS_JSON must be a service account key file (JSON with type "service_account").',
    ];
  }
  return [];
}
