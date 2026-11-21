/**
 * Which web app the shell loads (ADR-29 decision 3).
 *
 * The shell carries no environment (ADR-24 rule I2): every build opens
 * production. Staging is an internal launch option, `--app-url=` or
 * `FRAPP_DESKTOP_APP_URL`, and only the origins below are accepted, so a
 * stray flag or a link can never point a member's app at another site.
 * `localhost:3000` (the web dev server) is accepted only from an unpackaged
 * `npm start`, never from an installed app.
 */

export const PRODUCTION_APP_URL = "https://app.frapp.live";

const RELEASE_ORIGINS = ["https://app.frapp.live", "https://app.staging.frapp.live"] as const;
const DEV_ORIGINS = ["http://localhost:3000"] as const;

const APP_URL_FLAG = "--app-url=";
export const APP_URL_ENV = "FRAPP_DESKTOP_APP_URL";

/** The origins this build may load. */
function allowedOrigins(isPackaged: boolean): readonly string[] {
  return isPackaged ? RELEASE_ORIGINS : [...RELEASE_ORIGINS, ...DEV_ORIGINS];
}

/** `url`'s origin, or `null` when it does not parse. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The origin to load: the flag if given, else the environment variable, else
 * production. A requested value outside `allowedOrigins` falls back to
 * production rather than failing to start, and `rejected` says so, so the
 * caller can log it.
 */
export function resolveAppOrigin(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  isPackaged: boolean;
}): { origin: string; rejected: string | null } {
  const flag = input.argv.find((arg) => arg.startsWith(APP_URL_FLAG));
  const requested = flag ? flag.slice(APP_URL_FLAG.length) : input.env[APP_URL_ENV];
  if (!requested) return { origin: PRODUCTION_APP_URL, rejected: null };
  const origin = originOf(requested);
  if (origin && allowedOrigins(input.isPackaged).includes(origin)) {
    return { origin, rejected: null };
  }
  return { origin: PRODUCTION_APP_URL, rejected: requested };
}
