import { Platform } from "react-native";
import * as Application from "expo-application";
import { isExpoGo } from "./expo-go";

/**
 * The `X-Client-Version` value this build sends on every API request (#2526):
 * `<ios|android>/<version>+<build>`, from the same native fields as the Sentry
 * release (`lib/sentry/release.runtime.ts`). `GET /v1/client-policy` compares
 * it against the deployment's minimum, so the logic that decides "too old"
 * stays on the server, where it can still change after this binary ships.
 *
 * Omitted, not invented, when there is no native build to name: on web, and
 * in Expo Go, whose `nativeApplicationVersion` is Expo Go's own. An absent
 * header is always "supported", so neither can be locked out by a minimum
 * meant for store builds.
 */
export function formatClientVersion(parts: {
  platform: string;
  version: string | null | undefined;
  build: string | null | undefined;
}): string | undefined {
  const version = parts.version?.trim();
  if (!version) return undefined;
  const build = parts.build?.trim();
  return build
    ? `${parts.platform}/${version}+${build}`
    : `${parts.platform}/${version}`;
}

export function readClientVersion(): string | undefined {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return undefined;
  if (isExpoGo()) return undefined;
  return formatClientVersion({
    platform: Platform.OS,
    version: Application.nativeApplicationVersion,
    build: Application.nativeBuildVersion,
  });
}
