#!/usr/bin/env node

// Mobile native-declarations gate (#2343): what the iOS and Android builds
// actually declare, read from the config Expo's mods produce, not from app.json.
//
// Why the resolved config. The purpose strings a binary ships are written by
// the config plugins' Xcode mods. `IOSConfig.Permissions.applyPermissions`
// (`@expo/config-plugins/build/ios/Permissions.js`) deletes a key only when its
// option is strictly `false` and otherwise writes
// `option || infoPlist[key] || <the plugin's default string>`. So a guard that
// reads app.json can't see three things that each ship a real defect:
//
//   - An omitted option. Delete expo-camera's `"microphonePermission": false`
//     and the binary ships "Allow $(PRODUCT_NAME) to access your microphone", a
//     Guideline 5.1.1(i) purpose string for a feature that doesn't exist. The
//     string is never written into app.json.
//   - A vendor option spelled some other way (`cameraPermissionText`, say),
//     which no `*Permission` scan matches.
//   - A native dependency that uses a required-reason API. The categories
//     `ios.privacyManifests` declares came from an audit run by hand (#2294,
//     then #2526), so a new dependency using an undeclared category would be an
//     ITMS-91053 rejection on the next upload with every test green.
//
// `expo config --type introspect` runs the mods without writing a native
// project, about two seconds, and returns the Info.plist and the app's
// AndroidManifest they build from Expo's templates (the gate refuses to run
// over a generated apps/mobile/ios or android, which introspection would read
// instead). `expo prebuild --no-install` writes the same
// Info.plist keys and manifest entries, checked when this gate landed.
// `expo-modules-autolinking` lists the iOS pods the build links. The gate runs
// in CI's `mobile-validate` job, which already has the Expo toolchain installed.
//
// This file is the one home for the permission roster. `app.config.spec.ts`
// pins what app.json declares for the privacy manifest, and
// `frapp-mobile-permissions.test.mjs` pins only that the prompt copy names
// Frapp (ADR-25); neither keeps a list of which permissions exist.
//
// Four checks, all read from the resolved config:
//
// 1. iOS. The shipped `*UsageDescription*` keys are exactly
//    IOS_PURPOSE_STRINGS, each with its exact text, and each entry's
//    `requestedBy` call is still in the app's source (comments don't count).
//    A key for a feature the app doesn't have fails, however it got into
//    Info.plist. `UIBackgroundModes` is exactly IOS_BACKGROUND_MODES.
// 2. Android declarations. The app manifest declares exactly
//    ANDROID_RUNTIME_PERMISSIONS plus ANDROID_TEMPLATE_PERMISSIONS, and marks
//    none of the runtime ones `tools:node="remove"`.
// 3. Android removals. The app manifest's `tools:node="remove"` set is exactly
//    ANDROID_REMOVED_PERMISSIONS. A removal survives Gradle's manifest merge
//    and strips the permission from every library that adds it, so a new one
//    can break a feature the way #2296's did QR check-in; one that disappears
//    lets a declined permission back in.
// 4. Required-reason APIs. Every required-reason category the source of any
//    linked iOS pod uses is declared in `ios.privacyManifests`, whether or not
//    the pod ships its own manifest: static xcframeworks and Expo's precompiled
//    modules drop pod manifests from the shipped file (spec/ui/mobile/
//    navigation.md, the #2526 correction). The pods other than react-native's
//    that ship no manifest at all are exactly MANIFESTLESS_REQUIRED_REASON_USERS,
//    because their reason codes are the app's to declare. react-native's own
//    pods get theirs from its `pod install` aggregation, which merges a
//    hard-coded core list into the app's manifest, so the categories they use
//    must stay inside that list.
//
// What a green run does NOT prove:
//   - Library manifests merge into the Android manifest at Gradle build time,
//     which introspection doesn't run. So check 2 covers what the template and
//     config plugins declare. POST_NOTIFICATIONS, which expo-notifications' own
//     manifest adds, is protected only by check 3.
//   - Introspection starts from `@expo/config-plugins`' inline copy of Expo's
//     base Android manifest; prebuild and EAS start from the template bundled
//     as `expo/template.tgz`. They matched on SDK 57, but an SDK bump could
//     change one without the other, and nothing here compares them.
//   - The scan reads pod sources in node_modules. Native code the build fetches
//     from elsewhere isn't there: pods a podspec depends on (sentry-cocoa,
//     SDWebImage, ReachabilitySwift, react-native's third-party pods and
//     hermes-engine) and Swift packages (the Stripe iOS SDK, which
//     stripe-react-native takes through Swift Package Manager). The hand audit
//     beside the declared array in `app.config.spec.ts` covers sentry-cocoa and
//     SDWebImage. The rest rely on their own privacy manifests, which nothing
//     here checks yet (#3030).
//   - It matches symbols in the text, so it can't tell which reason code a use
//     needs. It proves each category is declared, not that the declared reason
//     is right. The manifest-less roster exists so that a change there brings
//     that question back to a person.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

const MOBILE_DIR = "apps/mobile";

/**
 * Every iOS purpose string the binary ships, keyed by its Info.plist key.
 * `requestedBy` is the call that shows the permission dialog: a purpose string
 * with no such call is a Guideline 5.1.1(i) rejection, and a call with no
 * purpose string crashes on iOS.
 *
 * Two plugin options that write no string here are load-bearing, and the
 * checks below catch either one changing:
 *   - expo-camera's and expo-image-picker's `microphonePermission: false`.
 *     Omitting either ships the plugin's default microphone string (check 1),
 *     and omitting image-picker's also stops it from declaring RECORD_AUDIO
 *     removed (check 3).
 *   - expo-image-picker has no `cameraPermission` key at all. `false` compiles
 *     to `withBlockedPermissions(['android.permission.CAMERA'])`, which broke QR
 *     check-in on every Android build (#2296); check 2 fails on it. Omitting it
 *     is safe because expo-camera writes NSCameraUsageDescription explicitly and
 *     `applyPermissions` keeps a value already written.
 */
export const IOS_PURPOSE_STRINGS = new Map([
  [
    "NSCameraUsageDescription",
    {
      text: "Frapp uses the camera to scan the check-in code at chapter events.",
      requestedBy: { file: "apps/mobile/app/(tabs)/check-in.tsx", call: "useCameraPermissions(" },
    },
  ],
  [
    "NSLocationWhenInUseUsageDescription",
    {
      text: "Frapp confirms you are inside a chapter study zone while you track study hours, and that you are at the event when you scan a check-in code.",
      requestedBy: { file: "apps/mobile/lib/location.ts", call: "requestForegroundPermissionsAsync(" },
    },
  ],
  [
    // Chat photos and the s15 profile photo both pick through this call.
    "NSPhotoLibraryUsageDescription",
    {
      text: "Frapp uses your photo library so you can set your profile photo and send photos in chapter chat.",
      requestedBy: {
        file: "apps/mobile/lib/chat/attachment-upload.ts",
        call: "requestMediaLibraryPermissionsAsync(",
      },
    },
  ],
]);

/**
 * The iOS background modes the binary declares. None: location is foreground
 * only (expo-location's `isIosBackgroundLocationEnabled: false`), and push
 * needs no mode while expo-notifications' `enableBackgroundRemoteNotifications`
 * is off. A mode for work the app doesn't do is a Guideline 2.5.4 finding.
 */
export const IOS_BACKGROUND_MODES = [];

/** Android permissions a screen requests at runtime, which a config plugin adds. */
export const ANDROID_RUNTIME_PERMISSIONS = new Map([
  ["android.permission.CAMERA", { file: "apps/mobile/app/(tabs)/check-in.tsx", call: "useCameraPermissions(" }],
  ["android.permission.ACCESS_FINE_LOCATION", { file: "apps/mobile/lib/location.ts", call: "requestForegroundPermissionsAsync(" }],
  ["android.permission.ACCESS_COARSE_LOCATION", { file: "apps/mobile/lib/location.ts", call: "requestForegroundPermissionsAsync(" }],
]);

/**
 * The rest of what the app manifest declares: Expo's base manifest. The gate
 * reads introspection's inline copy of it (`@expo/config-plugins`'
 * withAndroidBaseMods); prebuild and EAS copy the template bundled as
 * `expo/template.tgz`. The two declared these same five on SDK 57.
 */
export const ANDROID_TEMPLATE_PERMISSIONS = new Map([
  ["android.permission.INTERNET", "the app talks to the API and Supabase"],
  ["android.permission.VIBRATE", "notifications vibrate"],
  ["android.permission.SYSTEM_ALERT_WINDOW", "the template's; nothing in the app draws over other apps"],
  // Both capped at SDK 32. expo-image-picker's requestMediaLibraryPermissionsAsync
  // asks for both on Android 12 and below, and reports refused if either is
  // undeclared, so neither can be removed while chat photos and s15 pick.
  ["android.permission.READ_EXTERNAL_STORAGE", "the media-library request on Android 12 and below"],
  ["android.permission.WRITE_EXTERNAL_STORAGE", "the media-library request on Android 12 and below"],
]);

/**
 * Permissions the app manifest strips with `tools:node="remove"`, each with the
 * reason nothing in the app needs it.
 */
export const ANDROID_REMOVED_PERMISSIONS = new Map([
  [
    "android.permission.RECORD_AUDIO",
    "expo-image-picker's `microphonePermission: false`. Nothing records audio, and expo-camera's `recordAudioAndroid: false` keeps it from adding the permission. A slice that adds a microphone surface removes this entry and both declines",
  ],
]);

/**
 * Required-reason API symbols per privacy-manifest category, from Apple's
 * "Describing use of required reason API" list, in their Swift and
 * Objective-C/C spellings. A match is a use to account for, not proof of one:
 * `.creationDate` also matches PHAsset's, for example. Over-matching can only
 * ask for a declaration; it can't hide a missing one.
 */
export const REQUIRED_REASON_APIS = {
  NSPrivacyAccessedAPICategoryFileTimestamp: [
    /\bNSFile(?:Creation|Modification)Date\b/,
    /\bNSURL(?:ContentModification|Creation|AttributeModification|ContentAccess)DateKey\b/,
    /\b(?:contentModification|creation|attributeModification|contentAccess)DateKey\b/,
    /\.(?:creation|modification)Date\b/,
    /\bfileModificationDate\b/,
    /\b(?:f?getattrlist(?:bulk|at)?)\s*\(/,
    /\b(?:[fl]?stat|fstatat)\s*\(/,
  ],
  NSPrivacyAccessedAPICategorySystemBootTime: [/\bsystemUptime\b/, /\bmach_absolute_time\s*\(/],
  NSPrivacyAccessedAPICategoryDiskSpace: [
    /\bNSURLVolume(?:AvailableCapacity(?:ForImportantUsage|ForOpportunisticUsage)?|TotalCapacity)Key\b/,
    /\bvolume(?:AvailableCapacity(?:ForImportantUsage|ForOpportunisticUsage)?|TotalCapacity)Key\b/,
    /\bNSFileSystem(?:Free)?Size\b/,
    /\bsystem(?:Free)?Size\b/,
    /\bf?statv?fs\s*\(/,
  ],
  NSPrivacyAccessedAPICategoryActiveKeyboards: [/\bactiveInputModes\b/],
  NSPrivacyAccessedAPICategoryUserDefaults: [/\bNSUserDefaults\b/, /\bUserDefaults\b/],
};

/**
 * Linked iOS pods that use a required-reason API and ship no `.xcprivacy` of
 * their own, with the categories the scan finds in them. Their reason codes
 * are the app's to declare, so a change to this list is a re-audit of
 * `ios.privacyManifests`. The reason each one rests on is recorded once,
 * beside the declared array in app.config.spec.ts. An entry for react-native
 * would list the categories its pods use beyond the core list its
 * `pod install` aggregation declares; there is none today.
 */
export const MANIFESTLESS_REQUIRED_REASON_USERS = new Map([
  ["@stripe/stripe-react-native", ["NSPrivacyAccessedAPICategoryUserDefaults"]],
  ["expo-eas-client", ["NSPrivacyAccessedAPICategoryUserDefaults"]],
  ["expo-sharing", ["NSPrivacyAccessedAPICategoryUserDefaults"]],
  ["expo-updates", ["NSPrivacyAccessedAPICategoryUserDefaults"]],
]);

const REACT_NATIVE = "react-native";
const NATIVE_SOURCE = /\.(?:swift|m|mm|h|hpp|c|cc|cpp)$/;
// Android sources can't reach the iOS binary. ReactAndroid is react-native's.
const SKIP_DIRS = new Set(["node_modules", "android", "ReactAndroid"]);

/** Problems with the Info.plist's purpose strings, against IOS_PURPOSE_STRINGS. */
export function purposeStringProblems(infoPlist, roster = IOS_PURPOSE_STRINGS) {
  const problems = [];
  const shipped = Object.keys(infoPlist ?? {}).filter((key) => key.includes("UsageDescription"));
  for (const key of shipped.sort()) {
    const expected = roster.get(key);
    if (!expected) {
      problems.push(
        `iOS ships ${key} = ${JSON.stringify(infoPlist[key])}, which is not in IOS_PURPOSE_STRINGS: a purpose string for a feature the app doesn't have is a Guideline 5.1.1(i) rejection. If a plugin default wrote it, decline the option with \`false\`; if the feature is real, add the key to the roster`,
      );
    } else if (infoPlist[key] !== expected.text) {
      problems.push(
        `iOS ships ${key} = ${JSON.stringify(infoPlist[key])}, but the roster says ${JSON.stringify(expected.text)}`,
      );
    }
  }
  for (const key of roster.keys()) {
    if (!shipped.includes(key)) {
      problems.push(
        `iOS ships no ${key}, but ${roster.get(key).requestedBy.file} requests the permission: iOS terminates an app that asks without a purpose string`,
      );
    }
  }
  return problems;
}

/** Problems with the Info.plist's `UIBackgroundModes`, against IOS_BACKGROUND_MODES. */
export function backgroundModeProblems(infoPlist, modes = IOS_BACKGROUND_MODES) {
  const shipped = infoPlist?.UIBackgroundModes ?? [];
  if (!Array.isArray(shipped)) {
    return [`iOS ships UIBackgroundModes = ${JSON.stringify(shipped)}, which is not a list`];
  }
  const problems = [];
  for (const mode of [...new Set(shipped)].sort()) {
    if (!modes.includes(mode)) {
      problems.push(
        `iOS ships the ${JSON.stringify(mode)} background mode, which is not in IOS_BACKGROUND_MODES: a background mode for work the app doesn't do is a Guideline 2.5.4 finding. If a plugin option added it (expo-location's isIosBackgroundLocationEnabled, expo-notifications' enableBackgroundRemoteNotifications), set it back; if the feature is real, add the mode to the roster`,
      );
    }
  }
  for (const mode of modes) {
    if (!shipped.includes(mode)) problems.push(`iOS no longer ships the ${JSON.stringify(mode)} background mode the roster lists`);
  }
  return problems;
}

/**
 * Source text with its JS comments dropped and its string literals emptied, so
 * a call left in a comment or a string isn't read as a live one, and a `/*` or
 * `//` inside a string (`"image/*"`, `"//cdn…"`) can't swallow the code after
 * it. A lexer, not a parser: a `'` or `"` string ends at its line, as JS
 * requires, so an apostrophe in JSX text (`Can't scan`) or a regex literal
 * holding a quote, `//` or `/*` can hide a call on that line only, and then
 * fails the gate rather than passing it.
 */
export function withoutComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (pair === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote && (quote === "`" || source[j] !== "\n")) {
        j += source[j] === "\\" ? 2 : 1;
      }
      out += quote + quote;
      // A closing quote is consumed; a newline that ended an unclosed string isn't.
      i = source[j] === quote ? j + 1 : j;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Problems with the roster's `requestedBy` calls, given a reader from a
 * repo-relative path to its text (null when the file is missing). A call that
 * survives only in a comment doesn't count.
 */
export function requesterProblems(readSource, rosters = [IOS_PURPOSE_STRINGS, ANDROID_RUNTIME_PERMISSIONS]) {
  const problems = [];
  for (const roster of rosters) {
    for (const [key, entry] of roster) {
      const { file, call } = entry.requestedBy ?? entry;
      const source = readSource(file);
      if (source === null) {
        problems.push(`${key}: its requester ${file} no longer exists`);
      } else if (!withoutComments(source).includes(call)) {
        problems.push(
          `${key}: ${file} no longer calls ${call.replace(/\($/, "")}. If the feature is gone, drop the permission and its roster entry; if the call moved, update requestedBy`,
        );
      }
    }
  }
  return problems;
}

/** `{ name, remove }` for each `<uses-permission>` in an introspected AndroidManifest. */
export function manifestPermissions(manifest) {
  const entries = manifest?.manifest?.["uses-permission"];
  if (!Array.isArray(entries)) return null;
  return entries.map((entry) => ({
    name: entry?.$?.["android:name"],
    remove: entry?.$?.["tools:node"] === "remove",
  }));
}

/** Problems with the app manifest's permissions, against the three Android rosters. */
export function androidPermissionProblems(
  manifest,
  {
    runtime = ANDROID_RUNTIME_PERMISSIONS,
    template = ANDROID_TEMPLATE_PERMISSIONS,
    removed = ANDROID_REMOVED_PERMISSIONS,
  } = {},
) {
  const entries = manifestPermissions(manifest);
  if (!entries) {
    return [
      "the introspected AndroidManifest has no <uses-permission> list, so nothing could be checked. Has the Expo CLI output changed shape?",
    ];
  }
  const problems = [];
  for (const permission of runtime.keys()) {
    if (!entries.some((entry) => entry.name === permission && !entry.remove)) {
      problems.push(`the Android manifest doesn't declare ${permission}, which a screen requests at runtime`);
    }
  }
  const declared = [...new Set(entries.filter((entry) => !entry.remove).map((entry) => entry.name))].sort();
  const removals = [...new Set(entries.filter((entry) => entry.remove).map((entry) => entry.name))].sort();
  for (const permission of declared) {
    if (!runtime.has(permission) && !template.has(permission)) {
      problems.push(
        `the Android manifest declares ${permission}, which is in neither ANDROID_RUNTIME_PERMISSIONS nor ANDROID_TEMPLATE_PERMISSIONS: a permission for a feature the app doesn't have is a Play policy finding, and background location needs its own declaration. If a plugin option added it, set the option back; if the feature is real, add it to the roster`,
      );
    }
  }
  for (const permission of template.keys()) {
    if (!declared.includes(permission) && !removals.includes(permission)) {
      problems.push(
        `the Android manifest no longer declares ${permission}, which Expo's base manifest did. Update ANDROID_TEMPLATE_PERMISSIONS once you know why`,
      );
    }
  }
  for (const permission of removals) {
    if (runtime.has(permission)) {
      problems.push(
        `the Android manifest removes ${permission} (tools:node="remove"), which a screen requests at runtime. A plugin option set to \`false\` is the usual cause (#2296)`,
      );
    } else if (!removed.has(permission)) {
      problems.push(
        `the Android manifest removes ${permission} (tools:node="remove"), which is not in ANDROID_REMOVED_PERMISSIONS: a removal strips the permission from every library that adds it`,
      );
    }
  }
  for (const permission of removed.keys()) {
    if (!removals.includes(permission)) {
      problems.push(
        `the Android manifest no longer removes ${permission}. The plugin option that declined it has changed, so the permission can reach the build again`,
      );
    }
  }
  return problems;
}

/** The required-reason categories a source file's text uses. */
export function requiredReasonCategories(source, apis = REQUIRED_REASON_APIS) {
  return Object.keys(apis)
    .filter((category) => apis[category].some((pattern) => pattern.test(source)))
    .sort();
}

/**
 * Every linked iOS pod directory as `{ packageName, dir }`, from the two
 * autolinking reports, once each: `expo` is in both reports, and two of
 * expo-modules-core's pods share its root.
 */
export function linkedIosPods({ expoModules, reactNativeConfig }) {
  const pods = new Map();
  const add = (packageName, dir) => {
    if (dir && !pods.has(dir)) pods.set(dir, { packageName, dir });
  };
  for (const module of expoModules?.modules ?? []) {
    for (const pod of module.pods ?? []) add(module.packageName, pod.podspecDir);
  }
  for (const [packageName, dependency] of Object.entries(reactNativeConfig?.dependencies ?? {})) {
    const podspec = dependency?.platforms?.ios?.podspecPath;
    if (podspec) add(packageName, dirname(podspec));
  }
  // react-native's own pods: react-native-config names the package, not a dependency.
  add("react-native", reactNativeConfig?.reactNativePath);
  return [...pods.values()];
}

/**
 * The categories react-native's `pod install` aggregation merges into the
 * app's manifest for its own pods: `get_core_accessed_apis` in
 * `scripts/cocoapods/privacy_manifest_utils.rb`. Empty when the method can't
 * be found, which the caller reports.
 */
export function reactNativeCoreCategories(rubySource) {
  const body = rubySource?.match(/def self\.get_core_accessed_apis\b([\s\S]*?)\n\s*end\b/)?.[1] ?? "";
  return [...new Set(body.match(/NSPrivacyAccessedAPICategory\w+/g) ?? [])].sort();
}

/** The categories a pod directory's native sources use, and whether it ships a manifest. */
export function scanPod(dir, apis = REQUIRED_REASON_APIS) {
  const categories = new Map();
  let hasManifest = false;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
        continue;
      }
      if (entry.name.endsWith(".xcprivacy")) hasManifest = true;
      if (!entry.isFile() || !NATIVE_SOURCE.test(entry.name)) continue;
      for (const category of requiredReasonCategories(readFileSync(path, "utf8"), apis)) {
        if (!categories.has(category)) categories.set(category, []);
        categories.get(category).push(relative(dir, path).replaceAll("\\", "/"));
      }
    }
  };
  walk(dir);
  return { categories, hasManifest };
}

/**
 * Problems with the required-reason declarations, given each scanned pod
 * (`{ packageName, categories, hasManifest }`), the declared categories, and
 * the categories react-native's aggregation declares for its own pods.
 */
export function requiredReasonProblems(
  scanned,
  declared,
  { reactNativeCore, manifestless = MANIFESTLESS_REQUIRED_REASON_USERS } = {},
) {
  const problems = [];
  const declaredSet = new Set(declared);
  for (const pod of scanned) {
    for (const [category, files] of pod.categories) {
      if (!declaredSet.has(category)) {
        problems.push(
          `${pod.packageName} uses a ${category} API (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""}), and ios.privacyManifests doesn't declare the category: App Store Connect rejects the upload (ITMS-91053). Declare it in app.json with the reason that fits the use, and pin it in app.config.spec.ts`,
        );
      }
    }
  }

  // The categories whose reason codes are the app's to declare, one entry per
  // package (Expo modules can link several pods). A pod with its own manifest
  // has none. react-native's pods all sit under one root, and some ship a
  // manifest while others don't, so its own manifests can't settle it: its
  // aggregation covers the core list, and anything beyond that is the app's.
  const found = new Map();
  for (const pod of scanned) {
    let categories = [...pod.categories.keys()];
    if (pod.packageName === REACT_NATIVE) {
      if (!Array.isArray(reactNativeCore) || reactNativeCore.length === 0) {
        problems.push(
          "react-native's core required-reason list (get_core_accessed_apis in scripts/cocoapods/privacy_manifest_utils.rb) couldn't be read, so its pods' reason codes went unchecked",
        );
        continue;
      }
      categories = categories.filter((category) => !reactNativeCore.includes(category));
    } else if (pod.hasManifest) {
      continue;
    }
    if (categories.length === 0) continue;
    found.set(pod.packageName, [...new Set([...(found.get(pod.packageName) ?? []), ...categories])].sort());
  }
  const shippedManifest = new Set(scanned.filter((pod) => pod.hasManifest).map((pod) => pod.packageName));
  for (const [packageName, categories] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const expected = manifestless.get(packageName);
    if (!expected) {
      const why =
        packageName === REACT_NATIVE
          ? "beyond the core list its pod-install aggregation declares"
          : "and ships no privacy manifest";
      problems.push(
        `${packageName} uses ${categories.join(", ")} ${why}, so its reason codes are the app's to declare. Audit which reason fits, then add it to MANIFESTLESS_REQUIRED_REASON_USERS`,
      );
    } else if ([...expected].sort().join() !== categories.join()) {
      problems.push(
        `${packageName} now uses ${categories.join(", ")}, not ${expected.join(", ")}: re-audit its reason codes, then update MANIFESTLESS_REQUIRED_REASON_USERS`,
      );
    }
  }
  for (const packageName of manifestless.keys()) {
    if (!found.has(packageName)) {
      const why =
        packageName === REACT_NATIVE
          ? "now stays within the core list its pod-install aggregation declares"
          : shippedManifest.has(packageName)
            ? "now ships its own privacy manifest"
            : "is no longer a linked iOS pod using a required-reason API";
      problems.push(
        `${packageName} ${why}. Drop it from MANIFESTLESS_REQUIRED_REASON_USERS, and check whether the category it justified is still needed`,
      );
    }
  }
  return problems;
}

/** The categories `ios.privacyManifests` declares. */
export function declaredCategories(config) {
  return (config?.ios?.privacyManifests?.NSPrivacyAccessedAPITypes ?? [])
    .map((entry) => entry?.NSPrivacyAccessedAPIType)
    .filter(Boolean);
}

/**
 * Runs an Expo CLI (`cli` or `autolinking`, from the expo copy apps/mobile
 * resolves) in apps/mobile and parses its JSON output.
 */
export function expoCli(root) {
  const mobileDir = join(root, MOBILE_DIR);
  const expoDir = dirname(createRequire(join(mobileDir, "package.json")).resolve("expo/package.json"));
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1" };
  // app.config.js refuses an EAS production profile without Firebase config.
  // The shell running this may have inherited one, so resolve as plain CI does.
  delete env.EAS_BUILD_PROFILE;
  delete env.EAS_BUILD_PLATFORM;
  return (bin, args) => {
    const result = spawnSync(process.execPath, [join(expoDir, "bin", bin), ...args], {
      cwd: mobileDir,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`expo ${bin} ${args.join(" ")} exited ${result.status}:\n${result.stderr || result.error}`);
    }
    return JSON.parse(result.stdout);
  };
}

export function main(root = process.cwd(), run = expoCli(root)) {
  // Introspection reads the native project instead of Expo's templates when
  // one exists, and keeps what a stale Info.plist already says: a purpose
  // string left there hides the plugin default a clean build would ship. The
  // tree is generated and gitignored, so the gate reads only a clean checkout.
  const generated = ["ios", "android"].filter((dir) => existsSync(join(root, MOBILE_DIR, dir)));
  if (generated.length > 0) {
    return {
      checked: null,
      violations: [
        `${generated.map((dir) => `${MOBILE_DIR}/${dir}`).join(" and ")} exists, and introspection would read it instead of what a clean build generates. Delete the generated tree (it is gitignored) and run the gate again`,
      ],
    };
  }

  const config = run("cli", ["config", "--type", "introspect", "--json"]);
  const modResults = config?._internal?.modResults;
  if (!modResults?.ios?.infoPlist || !modResults?.android?.manifest) {
    return {
      checked: null,
      violations: [
        "expo config --type introspect returned no modResults.ios.infoPlist or modResults.android.manifest, so nothing could be checked. Has the Expo CLI output changed shape?",
      ],
    };
  }

  const reactNativeConfig = run("autolinking", ["react-native-config", "--platform", "ios", "--json"]);
  const pods = linkedIosPods({
    expoModules: run("autolinking", ["resolve", "--platform", "ios", "--json"]),
    reactNativeConfig,
  });
  const declared = declaredCategories(config);
  const setupProblems = [];
  if (pods.length === 0) setupProblems.push("autolinking listed no iOS pods, so the required-reason scan read nothing");
  if (declared.length === 0) setupProblems.push("ios.privacyManifests declares no required-reason categories");
  if (!reactNativeConfig?.reactNativePath) {
    setupProblems.push(
      "autolinking's react-native-config report names no reactNativePath, so react-native's own pods went unscanned. Has the Expo CLI output changed shape?",
    );
  }

  const readSource = (file) => {
    const path = join(root, file);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const scanned = pods.map((pod) => ({ packageName: pod.packageName, ...scanPod(pod.dir) }));
  const aggregation = reactNativeConfig?.reactNativePath
    ? join(reactNativeConfig.reactNativePath, "scripts/cocoapods/privacy_manifest_utils.rb")
    : null;
  const reactNativeCore =
    aggregation && existsSync(aggregation) ? reactNativeCoreCategories(readFileSync(aggregation, "utf8")) : [];

  return {
    checked: { purposeStrings: IOS_PURPOSE_STRINGS.size, pods: pods.length, declared },
    violations: [
      ...setupProblems,
      ...purposeStringProblems(modResults.ios.infoPlist),
      ...backgroundModeProblems(modResults.ios.infoPlist),
      ...requesterProblems(readSource),
      ...androidPermissionProblems(modResults.android.manifest),
      ...requiredReasonProblems(scanned, declared, { reactNativeCore }),
    ],
  };
}

if (isInvokedDirectly(import.meta.url)) {
  const { checked, violations } = main();
  if (violations.length === 0) {
    console.log(
      `✓ ${checked.purposeStrings} iOS purpose strings and the background modes, the Android manifest's declarations and removals, and ${checked.pods} linked iOS pod directories' required-reason APIs match the roster (${checked.declared.length} categories declared)`,
    );
    process.exit(0);
  }
  console.error("\n✗ Mobile native declarations don't match the roster.\n");
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\n  The roster and the reasons behind it are at the top of scripts/check-mobile-native-declarations.mjs.\n" +
      "  Read from `expo config --type introspect`, which is what the build ships, not from app.json.\n",
  );
  process.exit(1);
}
