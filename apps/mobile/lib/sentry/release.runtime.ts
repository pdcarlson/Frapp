import * as Application from "expo-application";
import Constants from "expo-constants";
import { formatMobileSentryDist, formatMobileSentryRelease } from "./release";
import type { MobileSentryReleaseExtras } from "./options";

function gitShaFromExpoExtra(): string | undefined {
  const extra = Constants.expoConfig?.extra as { gitSha?: unknown } | undefined;
  return typeof extra?.gitSha === "string" && extra.gitSha.length > 0
    ? extra.gitSha
    : undefined;
}

/**
 * Native bundle id / version / build number plus the EAS git SHA parked in
 * `app.config.js` `extra.gitSha`. Called from `app/_layout.tsx` at init so
 * `options.ts` stays type-only and free of Expo native modules.
 */
export function readMobileSentryReleaseExtras(): MobileSentryReleaseExtras {
  const release = formatMobileSentryRelease({
    bundleId: Application.applicationId,
    version: Application.nativeApplicationVersion,
    nativeBuildNumber: Application.nativeBuildVersion,
  });
  const dist = formatMobileSentryDist(Application.nativeBuildVersion);
  const gitSha = gitShaFromExpoExtra();
  return {
    ...(release ? { release } : {}),
    ...(dist ? { dist } : {}),
    ...(gitSha ? { gitSha } : {}),
  };
}
