import { envSetting, parseServiceAccount } from './ai-config';
import { runsOnCloudRun } from './runtime-platform';

type Env = Record<string, unknown>;

/** A Google service account's address. */
const SERVICE_ACCOUNT_EMAIL =
  /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;
/** The proof secret's shortest: 32 characters, as `openssl rand -hex 32` makes 64. */
const PROOF_SECRET_MIN = 32;

/**
 * The Google service account that reads what chapters share with Frapp in
 * Google Drive (#5157; `spec/behavior/chapter-docs.md` § Google Drive
 * folder). A chapter shares a folder or file with `clientEmail`, and the API
 * reads only what was shared with it, or what anyone with the link can open.
 * Each environment has its own account, so a staging chapter can never read
 * something shared with production.
 *
 * It signs in one of two ways:
 *
 * - **Without a key file, on Cloud Run** (#5434): `GOOGLE_DRIVE_SERVICE_ACCOUNT`
 *   names the Drive account, and the API, running as its own runtime
 *   identity, asks Google for a token that acts as it (the runtime identity
 *   holds Service Account Token Creator on that one account). The frapp.live
 *   organization blocks service account key files (#5323), so this is the
 *   way staging and production sign in. `GOOGLE_DRIVE_PROOF_SECRET` then keys
 *   the connect codes (#5185), since there is no private key to key them.
 * - **With a key file**, anywhere: `GOOGLE_DRIVE_CREDENTIALS_JSON`, the key
 *   file as JSON. Kept for a laptop or a project the policy doesn't cover.
 *
 * Unset, Google Drive is not offered and the sync worker leaves everything
 * as it is.
 */
export interface GoogleDriveServiceAccount {
  clientEmail: string;
  /** The key file's private key, or null to act as the account without one. */
  privateKey: string | null;
  /** What keys the connect codes: never sent anywhere. */
  proofSecret: string;
}

export function googleDriveServiceAccount(
  env: Env = process.env,
): GoogleDriveServiceAccount | null {
  const json = envSetting(env, 'GOOGLE_DRIVE_CREDENTIALS_JSON');
  const proofSecret = envSetting(env, 'GOOGLE_DRIVE_PROOF_SECRET');
  if (json) {
    const parsed = keyFile(json);
    if (!parsed) return null;
    const privateKey = parsed.private_key as string;
    return {
      clientEmail: parsed.client_email as string,
      privateKey,
      proofSecret: proofSecret ?? privateKey,
    };
  }
  const email = envSetting(env, 'GOOGLE_DRIVE_SERVICE_ACCOUNT');
  // Acting as the account takes the runtime's own identity, which only
  // Cloud Run gives this API. Anywhere else boot refuses it, as it refuses
  // Vertex AI without its key file (`ai-config.ts`).
  if (!email || !proofSecret || !runsOnCloudRun(env)) return null;
  return { clientEmail: email, privateKey: null, proofSecret };
}

/** A key file with a real private key: an empty one would key codes with nothing. */
function keyFile(json: string): Record<string, unknown> | null {
  const parsed = parseServiceAccount(json);
  return parsed && (parsed.private_key as string).trim() !== '' ? parsed : null;
}

/** Boot-time check, called from `validateEnv`. Never echoes a value. */
export function validateGoogleDriveEnv(env: Env): string[] {
  const problems: string[] = [];
  const json = envSetting(env, 'GOOGLE_DRIVE_CREDENTIALS_JSON');
  const email = envSetting(env, 'GOOGLE_DRIVE_SERVICE_ACCOUNT');
  const proofSecret = envSetting(env, 'GOOGLE_DRIVE_PROOF_SECRET');
  if (json && !keyFile(json)) {
    problems.push(
      'GOOGLE_DRIVE_CREDENTIALS_JSON must be a service account key file (JSON with type "service_account").',
    );
  }
  if (json && email) {
    problems.push(
      'Set GOOGLE_DRIVE_CREDENTIALS_JSON or GOOGLE_DRIVE_SERVICE_ACCOUNT, not both.',
    );
  }
  if (email && !SERVICE_ACCOUNT_EMAIL.test(email)) {
    problems.push(
      'GOOGLE_DRIVE_SERVICE_ACCOUNT must be a service account address (name@project.iam.gserviceaccount.com).',
    );
  }
  if (email && !runsOnCloudRun(env)) {
    problems.push(
      'GOOGLE_DRIVE_SERVICE_ACCOUNT is set without GOOGLE_DRIVE_CREDENTIALS_JSON. Only Cloud Run signs in without a key file.',
    );
  }
  if (email && !proofSecret) {
    problems.push(
      'GOOGLE_DRIVE_SERVICE_ACCOUNT needs GOOGLE_DRIVE_PROOF_SECRET, which keys the codes that prove a folder or file is the chapter’s.',
    );
  }
  if (proofSecret && proofSecret.length < PROOF_SECRET_MIN) {
    problems.push(
      `GOOGLE_DRIVE_PROOF_SECRET must be at least ${PROOF_SECRET_MIN} characters (openssl rand -hex 32).`,
    );
  }
  return problems;
}

/** A Google OAuth client id: the Cloud project's number, a dash, then the rest. */
const OAUTH_CLIENT_ID = /^(\d+)-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/**
 * What a browser needs to open Google's own folder picker (#5583): the
 * officer signs in with Google, picks the chapter's folder, and the API
 * shares it with the service account using that sign-in, once. Served by
 * `GET /v1/google-drive` rather than baked into the web build, so each
 * environment's values come from its own API.
 *
 * - `clientId`: the Google Calendar sign-in's Web OAuth client
 *   (`GOOGLE_CALENDAR_CLIENT_ID`), one per environment, whose Authorized
 *   JavaScript origins list the web app. Picking asks for `drive.file` only.
 * - `apiKey`: `GOOGLE_PICKER_API_KEY`, a browser key restricted to the
 *   Picker API and the web app's addresses. Public by design.
 * - `appId`: the Cloud project's number, the client id's prefix, so the
 *   folder picked is granted to this app.
 *
 * Null while either setting is unset, or the client id isn't a Google client
 * id; `GET /v1/google-drive` also offers none while Drive itself isn't
 * (no service account). Then only the link flow is offered.
 */
export interface GoogleDrivePicker {
  clientId: string;
  apiKey: string;
  appId: string;
}

export function googleDrivePicker(
  env: Env = process.env,
): GoogleDrivePicker | null {
  const clientId = envSetting(env, 'GOOGLE_CALENDAR_CLIENT_ID');
  const apiKey = envSetting(env, 'GOOGLE_PICKER_API_KEY');
  const project = clientId ? OAUTH_CLIENT_ID.exec(clientId) : null;
  if (!clientId || !apiKey || !project) return null;
  return { clientId, apiKey, appId: project[1] };
}
