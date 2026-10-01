import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// check-mobile-native-declarations.mjs is a general-purpose gate under
// scripts/ (a peer of check-expo-sdk-line.mjs); its test lives here so the
// `test:ci-scripts` glob runs it. That job has no `npm ci`, so nothing below
// runs the Expo CLI: main() takes the CLI runner as a parameter, and the real
// run is the `mobile-validate` step pinned at the bottom.
import { installsDependencies, workflowSteps } from "./helpers/workflow-yaml.mjs";
import {
  ANDROID_REMOVED_PERMISSIONS,
  ANDROID_RUNTIME_PERMISSIONS,
  ANDROID_TEMPLATE_PERMISSIONS,
  IOS_PURPOSE_STRINGS,
  MANIFESTLESS_REQUIRED_REASON_USERS,
  androidPermissionProblems,
  backgroundModeProblems,
  declaredCategories,
  linkedIosPods,
  main,
  purposeStringProblems,
  reactNativeCoreCategories,
  requesterProblems,
  requiredReasonCategories,
  requiredReasonProblems,
  scanPod,
  withoutComments,
} from "../../check-mobile-native-declarations.mjs";

const UD = "NSPrivacyAccessedAPICategoryUserDefaults";
const FT = "NSPrivacyAccessedAPICategoryFileTimestamp";
const BOOT = "NSPrivacyAccessedAPICategorySystemBootTime";
const DISK = "NSPrivacyAccessedAPICategoryDiskSpace";
const KEYS = "NSPrivacyAccessedAPICategoryActiveKeyboards";

/** The Info.plist the roster describes, plus the keys a real one also carries. */
function rosterInfoPlist(extra = {}) {
  const plist = { CFBundleDisplayName: "Frapp", ITSAppUsesNonExemptEncryption: false };
  for (const [key, { text }] of IOS_PURPOSE_STRINGS) plist[key] = text;
  return { ...plist, ...extra };
}

/** An introspected AndroidManifest in xml2js's shape, as the Expo CLI returns it. */
function manifestOf(entries) {
  return {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      "uses-permission": entries.map(([name, attrs = {}]) => ({ $: { "android:name": name, ...attrs } })),
    },
  };
}

const REMOVE = { "tools:node": "remove" };

/** The app manifest `expo config --type introspect` returned when this gate landed. */
function currentManifest() {
  return manifestOf([
    ["android.permission.INTERNET"],
    ["android.permission.SYSTEM_ALERT_WINDOW"],
    ["android.permission.VIBRATE"],
    ["android.permission.READ_EXTERNAL_STORAGE", { "android:maxSdkVersion": "32" }],
    ["android.permission.WRITE_EXTERNAL_STORAGE", { "android:maxSdkVersion": "32" }],
    ["android.permission.CAMERA"],
    ["android.permission.ACCESS_COARSE_LOCATION"],
    ["android.permission.ACCESS_FINE_LOCATION"],
    ["android.permission.RECORD_AUDIO", REMOVE],
  ]);
}

function pod(packageName, categories = {}, hasManifest = false) {
  return { packageName, categories: new Map(Object.entries(categories)), hasManifest };
}

/** The scan's result when this gate landed, reduced to the pods that matter. */
function currentScan() {
  return [
    pod("@stripe/stripe-react-native", { [UD]: ["ios/StripeSdkImpl.swift"] }),
    pod("expo-eas-client", { [UD]: ["EASClient/EASClientID.swift"] }),
    pod("expo-sharing", { [UD]: ["SharingModule.swift"] }),
    pod("expo-updates", { [UD]: ["EXUpdates/UpdatesConfigOverride.swift"] }),
    pod("expo-file-system", { [DISK]: ["FileSystemModule.swift"], [FT]: ["FileSystemPath.swift"] }, true),
    pod("react-native", { [BOOT]: ["React/Fabric/RCTConversions.h"], [FT]: ["x.mm"], [UD]: ["y.mm"] }, true),
    pod("expo-camera"),
  ];
}

const DECLARED = [UD, FT, BOOT, DISK];
/** What react-native's get_core_accessed_apis declared when this gate landed. */
const RN_CORE = { reactNativeCore: [FT, BOOT, UD] };

// ── 1. iOS purpose strings ───────────────────────────────────────────────────

test("the roster's own Info.plist passes", () => {
  assert.deepEqual(purposeStringProblems(rosterInfoPlist()), []);
});

test("an omitted option's plugin default fails (blind spot 1)", () => {
  // What deleting expo-camera's `"microphonePermission": false` ships.
  const problems = purposeStringProblems(
    rosterInfoPlist({ NSMicrophoneUsageDescription: "Allow $(PRODUCT_NAME) to access your microphone" }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /NSMicrophoneUsageDescription.*not in IOS_PURPOSE_STRINGS/);
});

test("a key written by a vendor option spelled any way, or by hand, fails (blind spot 2)", () => {
  // The check reads the Info.plist, so how the key got there doesn't matter:
  // `cameraPermissionText`, a raw `ios.infoPlist` entry and a plugin all land here.
  const problems = purposeStringProblems(rosterInfoPlist({ NSContactsUsageDescription: "Frapp reads contacts." }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /NSContactsUsageDescription/);
});

test("a dictionary-valued purpose key fails too", () => {
  const problems = purposeStringProblems(
    rosterInfoPlist({ NSLocationTemporaryUsageDescriptionDictionary: { Chapter: "Frapp needs it." } }),
  );
  assert.match(problems.join("\n"), /NSLocationTemporaryUsageDescriptionDictionary/);
});

test("a reworded purpose string fails", () => {
  const plist = rosterInfoPlist({ NSCameraUsageDescription: "Signet uses the camera." });
  assert.deepEqual(purposeStringProblems(plist), [
    `iOS ships NSCameraUsageDescription = "Signet uses the camera.", but the roster says ${JSON.stringify(
      IOS_PURPOSE_STRINGS.get("NSCameraUsageDescription").text,
    )}`,
  ]);
});

test("a missing purpose string fails, because iOS kills an app that asks without one", () => {
  const plist = rosterInfoPlist();
  delete plist.NSPhotoLibraryUsageDescription;
  const problems = purposeStringProblems(plist);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ships no NSPhotoLibraryUsageDescription.*attachment-upload\.ts/);
});

test("an empty Info.plist reports every roster key missing rather than passing", () => {
  assert.equal(purposeStringProblems({}).length, IOS_PURPOSE_STRINGS.size);
  assert.equal(purposeStringProblems(undefined).length, IOS_PURPOSE_STRINGS.size);
});

// ── the roster's requesters ──────────────────────────────────────────────────

test("every roster entry's requester call exists in the app today", () => {
  const read = (file) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  assert.deepEqual(requesterProblems(read), []);
});

test("a purpose string whose feature is gone fails", () => {
  const read = (file) => (file.endsWith("check-in.tsx") ? "export default function CheckIn() {}" : "useCameraPermissions( requestForegroundPermissionsAsync( requestMediaLibraryPermissionsAsync(");
  const problems = requesterProblems(read);
  assert.deepEqual(
    problems,
    [
      "NSCameraUsageDescription: apps/mobile/app/(tabs)/check-in.tsx no longer calls useCameraPermissions. If the feature is gone, drop the permission and its roster entry; if the call moved, update requestedBy",
      "android.permission.CAMERA: apps/mobile/app/(tabs)/check-in.tsx no longer calls useCameraPermissions. If the feature is gone, drop the permission and its roster entry; if the call moved, update requestedBy",
    ],
  );
});

test("a requester call that survives only in a comment fails", () => {
  const live = "requestForegroundPermissionsAsync( requestMediaLibraryPermissionsAsync(";
  for (const leftover of [
    "// was useCameraPermissions() before the check-in rebuild",
    "/* useCameraPermissions(); */",
    "/**\n * Calls useCameraPermissions() on mount.\n */",
  ]) {
    const problems = requesterProblems((file) => (file.endsWith("check-in.tsx") ? leftover : live));
    assert.equal(problems.length, 2, leftover);
    assert.match(problems[0], /check-in\.tsx no longer calls useCameraPermissions/);
  }
});

test("withoutComments drops comments and empties strings, and keeps the code around them", () => {
  assert.equal(withoutComments("a(); // b()\n/* c() */d();"), "a(); \nd();");
  assert.equal(withoutComments('const u = "https://frapp.live"; useCameraPermissions();'), 'const u = ""; useCameraPermissions();');
  // A call quoted in a string isn't a live one either.
  assert.equal(withoutComments("log('useCameraPermissions(');"), "log('');");
  assert.equal(withoutComments('a("x\\"y"); b(`t ${c} \\` d`);'), 'a(""); b(``);');
});

test("a /* or // inside a string, a line comment, or JSX text can't swallow a live requester call", () => {
  // Each once opened a fake comment or string running past the call.
  for (const before of [
    'const ACCEPT = ["image/*"];',
    'const cdn = "//cdn.frapp.live/x";',
    "// see lib/*.ts",
    "const Hint = () => <Text>Can't scan? Ask an officer.</Text>;",
  ]) {
    const source = `/** Picks a photo. */\n${before}\nexport async function pick() {\n  await requestMediaLibraryPermissionsAsync();\n}\n/** Next helper. */\n`;
    assert.ok(withoutComments(source).includes("requestMediaLibraryPermissionsAsync("), before);
  }
});

test("a deleted requester file fails", () => {
  const problems = requesterProblems((file) => (file.endsWith("location.ts") ? null : "useCameraPermissions( requestMediaLibraryPermissionsAsync("));
  assert.ok(problems.some((p) => p === "NSLocationWhenInUseUsageDescription: its requester apps/mobile/lib/location.ts no longer exists"), problems.join("\n"));
});

// ── 2 and 3. Android permissions ─────────────────────────────────────────────

test("the manifest introspection returned when this gate landed passes", () => {
  assert.deepEqual(androidPermissionProblems(currentManifest()), []);
});

test("a declined camera option on the picker fails, the #2296 defect", () => {
  // `cameraPermission: false` on expo-image-picker compiles to
  // withBlockedPermissions: the add disappears and a removal takes its place.
  const manifest = currentManifest();
  manifest.manifest["uses-permission"] = manifest.manifest["uses-permission"].filter(
    (entry) => entry.$["android:name"] !== "android.permission.CAMERA",
  );
  manifest.manifest["uses-permission"].push({ $: { "android:name": "android.permission.CAMERA", ...REMOVE } });
  const problems = androidPermissionProblems(manifest);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /doesn't declare android\.permission\.CAMERA/);
  assert.match(problems[1], /removes android\.permission\.CAMERA.*#2296/);
});

test("a removal alongside the add still fails, since the removal wins the merge", () => {
  const manifest = currentManifest();
  manifest.manifest["uses-permission"].push({ $: { "android:name": "android.permission.ACCESS_FINE_LOCATION", ...REMOVE } });
  assert.match(androidPermissionProblems(manifest).join("\n"), /removes android\.permission\.ACCESS_FINE_LOCATION/);
});

test("a new removal of a library's permission fails", () => {
  // POST_NOTIFICATIONS comes from expo-notifications' own manifest, which
  // introspection never sees; a removal in the app manifest would strip it.
  const manifest = currentManifest();
  manifest.manifest["uses-permission"].push({ $: { "android:name": "android.permission.POST_NOTIFICATIONS", ...REMOVE } });
  const problems = androidPermissionProblems(manifest);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /removes android\.permission\.POST_NOTIFICATIONS.*not in ANDROID_REMOVED_PERMISSIONS/);
});

test("losing the RECORD_AUDIO removal fails, since the picker then adds it (blind spot 1, Android half)", () => {
  const manifest = currentManifest();
  manifest.manifest["uses-permission"] = manifest.manifest["uses-permission"].map((entry) =>
    entry.$["android:name"] === "android.permission.RECORD_AUDIO"
      ? { $: { "android:name": "android.permission.RECORD_AUDIO" } }
      : entry,
  );
  const problems = androidPermissionProblems(manifest);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /declares android\.permission\.RECORD_AUDIO, which is in neither/);
  assert.match(problems[1], /no longer removes android\.permission\.RECORD_AUDIO/);
});

test("a manifest with no permission list fails instead of checking nothing", () => {
  assert.equal(androidPermissionProblems({ manifest: {} }).length, 1);
  assert.equal(androidPermissionProblems(undefined).length, 1);
});

test("the Android rosters don't overlap", () => {
  const rosters = [ANDROID_RUNTIME_PERMISSIONS, ANDROID_TEMPLATE_PERMISSIONS, ANDROID_REMOVED_PERMISSIONS];
  const all = rosters.flatMap((roster) => [...roster.keys()]);
  assert.equal(new Set(all).size, all.length, all.join(", "));
});

test("a permission a plugin option or app.json adds fails, background location included", () => {
  // isAndroidBackgroundLocationEnabled: true, or a hand-written android.permissions entry.
  const manifest = currentManifest();
  manifest.manifest["uses-permission"].push(
    { $: { "android:name": "android.permission.ACCESS_BACKGROUND_LOCATION" } },
    { $: { "android:name": "android.permission.READ_CONTACTS" } },
  );
  const problems = androidPermissionProblems(manifest);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /declares android\.permission\.ACCESS_BACKGROUND_LOCATION, which is in neither/);
  assert.match(problems[1], /declares android\.permission\.READ_CONTACTS/);
});

test("a template permission that disappears fails, so the roster stays exact", () => {
  const manifest = currentManifest();
  manifest.manifest["uses-permission"] = manifest.manifest["uses-permission"].filter(
    (entry) => entry.$["android:name"] !== "android.permission.VIBRATE",
  );
  assert.deepEqual(androidPermissionProblems(manifest).map((p) => p.split(",")[0]), [
    "the Android manifest no longer declares android.permission.VIBRATE",
  ]);
});

test("no background mode ships today, and one a plugin adds fails", () => {
  assert.deepEqual(backgroundModeProblems(rosterInfoPlist()), []);
  assert.deepEqual(backgroundModeProblems(rosterInfoPlist({ UIBackgroundModes: [] })), []);
  // isIosBackgroundLocationEnabled: true
  const problems = backgroundModeProblems(rosterInfoPlist({ UIBackgroundModes: ["location"] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"location" background mode.*Guideline 2\.5\.4/);
  assert.match(backgroundModeProblems(rosterInfoPlist({ UIBackgroundModes: "location" }))[0], /not a list/);
  assert.deepEqual(backgroundModeProblems(rosterInfoPlist(), ["remote-notification"]), [
    'iOS no longer ships the "remote-notification" background mode the roster lists',
  ]);
});

// ── 4. required-reason APIs ──────────────────────────────────────────────────

test("each category is recognised in Swift and Objective-C spellings", () => {
  const cases = [
    ["let d = UserDefaults.standard", [UD]],
    ["[NSUserDefaults standardUserDefaults]", [UD]],
    ["attrs[.modificationDate]", [FT]],
    ["[attrs objectForKey:NSFileModificationDate]", [FT]],
    ["url.resourceValues(forKeys: [.contentModificationDateKey])", [FT]],
    ["if (stat(path, &st) == 0) {}", [FT]],
    ["fstatat(fd, name, &st, 0);", [FT]],
    ["ProcessInfo.processInfo.systemUptime", [BOOT]],
    ["uint64_t t = mach_absolute_time();", [BOOT]],
    ["forKeys: [.volumeAvailableCapacityForImportantUsageKey]", [DISK]],
    ["attrs[NSFileSystemFreeSize]", [DISK]],
    ["statfs(path, &buf);", [DISK]],
    ["UITextInputMode.activeInputModes", [KEYS]],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(requiredReasonCategories(source), expected, source);
  }
});

test("look-alikes aren't counted", () => {
  for (const source of [
    "let status = response.status(code)",
    "restat(path)",
    "struct statistics {}",
    "let UserDefaultsKey = 1",
    "mach_absolute_time_units",
    "",
  ]) {
    assert.deepEqual(requiredReasonCategories(source), [], source);
  }
});

test("the scan when this gate landed passes", () => {
  assert.deepEqual(requiredReasonProblems(currentScan(), DECLARED, RN_CORE), []);
});

test("an undeclared category fails, whether or not the pod ships a manifest (blind spot 3)", () => {
  // A pod's own manifest can be dropped (static xcframework, precompiled
  // Expo module), so a manifest doesn't excuse the app's declaration.
  const problems = requiredReasonProblems(
    [...currentScan(), pod("expo-keyboard-thing", { [KEYS]: ["A.swift", "B.swift", "C.swift", "D.swift"] }, true)],
    DECLARED,
    RN_CORE,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expo-keyboard-thing uses a NSPrivacyAccessedAPICategoryActiveKeyboards API \(A\.swift, B\.swift, C\.swift, …\).*ITMS-91053/);
});

test("dropping a declared category a pod uses fails", () => {
  const problems = requiredReasonProblems(currentScan(), [UD, FT, BOOT], RN_CORE);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expo-file-system uses a NSPrivacyAccessedAPICategoryDiskSpace API/);
});

test("a new manifest-less user of a declared category fails, because its reason code needs an audit", () => {
  // react-native-device-info's shape: DiskSpace and SystemBootTime, no manifest.
  const problems = requiredReasonProblems(
    [...currentScan(), pod("react-native-device-info", { [DISK]: ["RNDeviceInfo.m"], [BOOT]: ["RNDeviceInfo.m"] })],
    DECLARED,
    RN_CORE,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /react-native-device-info uses NSPrivacyAccessedAPICategoryDiskSpace, NSPrivacyAccessedAPICategorySystemBootTime and ships no privacy manifest/);
});

test("a roster package using a new category fails", () => {
  const scan = currentScan();
  scan[0] = pod("@stripe/stripe-react-native", { [UD]: ["a.swift"], [DISK]: ["b.swift"] });
  const problems = requiredReasonProblems(scan, DECLARED, RN_CORE);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /@stripe\/stripe-react-native now uses .*DiskSpace.*UserDefaults, not .*UserDefaults/);
});

test("a roster package that gains a manifest, or leaves, fails so the roster shrinks", () => {
  const scan = currentScan().filter((p) => p.packageName !== "expo-sharing");
  scan.push(pod("expo-updates", {}, true));
  const withManifest = scan.map((p) => (p.packageName === "expo-updates" ? { ...p, hasManifest: true } : p));
  assert.deepEqual(
    requiredReasonProblems(withManifest, DECLARED, RN_CORE).map((problem) => problem.split(".")[0]),
    ["expo-sharing is no longer a linked iOS pod using a required-reason API", "expo-updates now ships its own privacy manifest"],
  );
});

test("react-native's pods may use only what its aggregation's core list declares", () => {
  // React-RCTSettings and React-CoreModules ship no manifest, and React-Core's
  // manifest sits under the same root, so a manifest can't excuse them.
  const scan = currentScan().map((p) =>
    p.packageName === "react-native" ? pod("react-native", { [UD]: ["a.mm"], [DISK]: ["Libraries/Disk/RCTDisk.mm"] }, true) : p,
  );
  const problems = requiredReasonProblems(scan, DECLARED, RN_CORE);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^react-native uses NSPrivacyAccessedAPICategoryDiskSpace beyond the core list its pod-install aggregation declares/);
  // Once audited, the roster records it like any manifest-less pod.
  const audited = new Map([...MANIFESTLESS_REQUIRED_REASON_USERS, ["react-native", [DISK]]]);
  assert.deepEqual(requiredReasonProblems(scan, DECLARED, { ...RN_CORE, manifestless: audited }), []);
  assert.match(
    requiredReasonProblems(currentScan(), DECLARED, { ...RN_CORE, manifestless: audited }).join("\n"),
    /react-native now stays within the core list/,
  );
});

test("an unreadable react-native core list fails rather than excusing its pods", () => {
  const problems = requiredReasonProblems(currentScan(), DECLARED, { reactNativeCore: [] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /core required-reason list .* couldn't be read/);
});

test("reactNativeCoreCategories reads get_core_accessed_apis and nothing else", () => {
  const ruby = `
    def self.get_privacy_manifest_paths_from(user_project)
        "NSPrivacyAccessedAPICategoryDiskSpace"
    end

    def self.get_core_accessed_apis()
        file_timestamp_accessed_api = {
            "NSPrivacyAccessedAPIType" => "NSPrivacyAccessedAPICategoryFileTimestamp",
            "NSPrivacyAccessedAPITypeReasons" => ["C617.1"],
        }
        boot_time_accessed_api = {
            "NSPrivacyAccessedAPIType" => "NSPrivacyAccessedAPICategorySystemBootTime",
        }
        return [file_timestamp_accessed_api, boot_time_accessed_api]
    end
  `;
  assert.deepEqual(reactNativeCoreCategories(ruby), [FT, BOOT]);
  assert.deepEqual(reactNativeCoreCategories("def self.something_else\nend"), []);
  assert.deepEqual(reactNativeCoreCategories(undefined), []);
});

test("a roster entry's category order doesn't matter", () => {
  const scan = [...currentScan(), pod("react-native-device-info", { [DISK]: ["a.m"], [BOOT]: ["a.m"] })];
  const roster = new Map([...MANIFESTLESS_REQUIRED_REASON_USERS, ["react-native-device-info", [BOOT, DISK]]]);
  assert.deepEqual(requiredReasonProblems(scan, DECLARED, { ...RN_CORE, manifestless: roster }), []);
});

test("an Expo module's pods are one roster entry", () => {
  const problems = requiredReasonProblems(
    [
      ...currentScan().filter((p) => p.packageName !== "expo-updates"),
      pod("expo-updates", { [UD]: ["EXUpdates/UpdatesConfigOverride.swift"] }),
      pod("expo-updates", {}),
    ],
    DECLARED,
    RN_CORE,
  );
  assert.deepEqual(problems, []);
});

test("every category the manifest-less roster names is declared in app.json", () => {
  const appJson = JSON.parse(readFileSync("apps/mobile/app.json", "utf8"));
  const declared = declaredCategories(appJson.expo);
  for (const [packageName, categories] of MANIFESTLESS_REQUIRED_REASON_USERS) {
    for (const category of categories) assert.ok(declared.includes(category), `${packageName}: ${category}`);
  }
});

test("scanPod reads native sources only, skips Android and nested packages, and sees a manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "native-pod-"));
  try {
    const put = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    put("ios/Module.swift", "UserDefaults.standard");
    put("ios/Legacy/Timer.m", "mach_absolute_time();");
    put("android/src/Module.kt", "UITextInputMode.activeInputModes");
    put("android/src/jni.cpp", "UITextInputMode.activeInputModes");
    put("node_modules/dep/ios/Dep.swift", "UITextInputMode.activeInputModes");
    put(".build/Cache.swift", "UITextInputMode.activeInputModes");
    put("src/index.ts", "UITextInputMode.activeInputModes");

    let scanned = scanPod(dir);
    assert.equal(scanned.hasManifest, false);
    assert.deepEqual(Object.fromEntries(scanned.categories), { [UD]: ["ios/Module.swift"], [BOOT]: ["ios/Legacy/Timer.m"] });

    put("ios/PrivacyInfo.xcprivacy", "<plist/>");
    scanned = scanPod(dir);
    assert.equal(scanned.hasManifest, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("linkedIosPods takes Expo modules, community modules and react-native itself", () => {
  const pods = linkedIosPods({
    expoModules: {
      modules: [
        { packageName: "expo-modules-core", pods: [{ podName: "ExpoModulesCore", podspecDir: "/n/expo-modules-core/ios" }, { podName: "ExpoModulesWorklets", podspecDir: "/n/expo-modules-core/ios/Worklets" }] },
      ],
    },
    reactNativeConfig: {
      reactNativePath: "/n/react-native",
      dependencies: {
        "@stripe/stripe-react-native": { platforms: { ios: { podspecPath: "/n/@stripe/stripe-react-native/stripe-react-native.podspec" } } },
        "android-only": { platforms: { ios: null, android: {} } },
      },
    },
  });
  assert.deepEqual(pods, [
    { packageName: "expo-modules-core", dir: "/n/expo-modules-core/ios" },
    { packageName: "expo-modules-core", dir: "/n/expo-modules-core/ios/Worklets" },
    { packageName: "@stripe/stripe-react-native", dir: "/n/@stripe/stripe-react-native" },
    { packageName: "react-native", dir: "/n/react-native" },
  ]);
});

test("linkedIosPods scans a directory once, however many reports or pods name it", () => {
  const pods = linkedIosPods({
    expoModules: {
      modules: [
        { packageName: "expo", pods: [{ podName: "Expo", podspecDir: "/n/expo" }] },
        { packageName: "expo-modules-core", pods: [{ podName: "ExpoModulesCore", podspecDir: "/n/emc" }, { podName: "ExpoModulesWorklets", podspecDir: "/n/emc" }] },
      ],
    },
    reactNativeConfig: { dependencies: { expo: { platforms: { ios: { podspecPath: "/n/expo/Expo.podspec" } } } } },
  });
  assert.deepEqual(pods.map((p) => p.dir), ["/n/expo", "/n/emc"]);
});

// ── main ─────────────────────────────────────────────────────────────────────

/** A repo root whose requesters exist, one pod dir, and a runner faking the Expo CLI. */
const AGGREGATION_RB = `
    def self.get_core_accessed_apis()
        a = { "NSPrivacyAccessedAPIType" => "${FT}" }
        b = { "NSPrivacyAccessedAPIType" => "${UD}" }
        c = { "NSPrivacyAccessedAPIType" => "${BOOT}" }
        return [a, b, c]
    end
`;

function fixture({
  infoPlist = rosterInfoPlist(),
  manifest = currentManifest(),
  declared = DECLARED,
  podSource = "UserDefaults.standard",
  modules,
  checkIn = "useCameraPermissions();",
  reactNativeSource = "[[NSUserDefaults standardUserDefaults] boolForKey:k]; mach_absolute_time();",
  aggregation = AGGREGATION_RB,
  reactNativePath = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-declarations-"));
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("apps/mobile/app/(tabs)/check-in.tsx", checkIn);
  put("apps/mobile/lib/location.ts", "requestForegroundPermissionsAsync();");
  put("apps/mobile/lib/chat/attachment-upload.ts", "requestMediaLibraryPermissionsAsync();");
  const podDirs = {};
  for (const name of MANIFESTLESS_REQUIRED_REASON_USERS.keys()) {
    podDirs[name] = join(root, "node_modules", name, "ios");
    put(`node_modules/${name}/ios/Module.swift`, podSource);
  }
  put("node_modules/react-native/React/Base/RCTThing.mm", reactNativeSource);
  if (aggregation !== null) put("node_modules/react-native/scripts/cocoapods/privacy_manifest_utils.rb", aggregation);
  const outputs = {
    config: {
      ios: { privacyManifests: { NSPrivacyAccessedAPITypes: declared.map((c) => ({ NSPrivacyAccessedAPIType: c })) } },
      _internal: { modResults: { ios: { infoPlist }, android: { manifest } } },
    },
    resolve: modules ?? {
      modules: Object.entries(podDirs).map(([packageName, podspecDir]) => ({ packageName, pods: [{ podName: packageName, podspecDir }] })),
    },
    rnConfig: { dependencies: {}, ...(reactNativePath ? { reactNativePath: join(root, "node_modules/react-native") } : {}) },
  };
  const calls = [];
  const run = (bin, args) => {
    calls.push(`${bin} ${args.join(" ")}`);
    if (bin === "cli") return outputs.config;
    return args[0] === "resolve" ? outputs.resolve : outputs.rnConfig;
  };
  return { root, run, calls, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("main passes a coherent project, and asks the CLI for iOS introspection and both pod lists", () => {
  const f = fixture();
  try {
    const { checked, violations } = main(f.root, f.run);
    assert.deepEqual(violations, []);
    assert.equal(checked.pods, MANIFESTLESS_REQUIRED_REASON_USERS.size + 1, "the roster's pods plus react-native");
    assert.deepEqual(f.calls, [
      "cli config --type introspect --json",
      "autolinking react-native-config --platform ios --json",
      "autolinking resolve --platform ios --json",
    ]);
  } finally {
    f.cleanup();
  }
});

test("main reports each check's failure together", () => {
  const f = fixture({
    infoPlist: rosterInfoPlist({ NSMicrophoneUsageDescription: "Allow $(PRODUCT_NAME) to access your microphone" }),
    manifest: manifestOf([["android.permission.CAMERA", REMOVE]]),
    podSource: "UserDefaults.standard; UITextInputMode.activeInputModes",
  });
  try {
    const text = main(f.root, f.run).violations.join("\n");
    assert.match(text, /NSMicrophoneUsageDescription/);
    assert.match(text, /removes android\.permission\.CAMERA/);
    assert.match(text, /ActiveKeyboards API/);
  } finally {
    f.cleanup();
  }
});

test("main reports a purpose string whose requester is gone", () => {
  const f = fixture({ checkIn: "// useCameraPermissions() went with the old scanner\nexport default function CheckIn() {}" });
  try {
    const { violations } = main(f.root, f.run);
    assert.deepEqual(violations.map((v) => v.split(":")[0]), ["NSCameraUsageDescription", "android.permission.CAMERA"]);
  } finally {
    f.cleanup();
  }
});

test("main checks react-native's pods against the core list it reads from react-native itself", () => {
  // DiskSpace is declared by the app, but it isn't on react-native's core list.
  const f = fixture({ reactNativeSource: "[attrs objectForKey:NSFileSystemFreeSize];" });
  try {
    const { violations } = main(f.root, f.run);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /^react-native uses NSPrivacyAccessedAPICategoryDiskSpace beyond the core list/);
  } finally {
    f.cleanup();
  }
});

test("main fails when react-native's aggregation file is gone, rather than excusing its pods", () => {
  const f = fixture({ aggregation: null });
  try {
    assert.match(main(f.root, f.run).violations.join("\n"), /core required-reason list .* couldn't be read/);
  } finally {
    f.cleanup();
  }
});

test("main fails when autolinking stops naming react-native's root", () => {
  const f = fixture({ reactNativePath: false });
  try {
    const { violations } = main(f.root, f.run);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /names no reactNativePath, so react-native's own pods went unscanned/);
  } finally {
    f.cleanup();
  }
});

test("main reports a background mode", () => {
  const f = fixture({ infoPlist: rosterInfoPlist({ UIBackgroundModes: ["location"] }) });
  try {
    assert.match(main(f.root, f.run).violations.join("\n"), /"location" background mode/);
  } finally {
    f.cleanup();
  }
});

test("main fails when introspection loses its shape, rather than passing on nothing", () => {
  const f = fixture();
  try {
    const run = (bin, args) => (bin === "cli" ? { ios: {} } : f.run(bin, args));
    const { violations } = main(f.root, run);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /returned no modResults/);
  } finally {
    f.cleanup();
  }
});

test("main refuses to read a generated native tree, which can hide a plugin default", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "apps/mobile/ios"), { recursive: true });
    const { violations } = main(f.root, f.run);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /^apps\/mobile\/ios exists/);
    assert.deepEqual(f.calls, [], "the CLI must not run over the stale tree");
  } finally {
    f.cleanup();
  }
});

test("main fails when autolinking lists no pods or nothing is declared", () => {
  const f = fixture({ modules: { modules: [] }, declared: [], reactNativePath: false });
  try {
    const { violations } = main(f.root, f.run);
    assert.ok(violations.includes("autolinking listed no iOS pods, so the required-reason scan read nothing"), violations.join("\n"));
    assert.ok(violations.includes("ios.privacyManifests declares no required-reason categories"), violations.join("\n"));
  } finally {
    f.cleanup();
  }
});

// ── wiring ───────────────────────────────────────────────────────────────────

test("mobile-validate runs the gate, able to fail the job", () => {
  const steps = workflowSteps(".github/workflows/ci.yml").filter((step) => step.jobId === "mobile-validate");
  const at = (re) => steps.findIndex((step) => re.test(step.body));
  const install = steps.findIndex(installsDependencies);
  const gate = at(/^\s*-?\s*run:\s*npm\s+run\s+check:mobile-native-declarations\s*$/m);
  assert.ok(gate !== -1, "mobile-validate has no `npm run check:mobile-native-declarations` step");
  const prebuild = at(/\bexpo\s+prebuild\b/);
  assert.ok(install !== -1 && install < gate, "the gate needs the Expo toolchain, so it runs after npm ci");
  assert.ok(prebuild !== -1 && gate < prebuild, "the gate runs before prebuild writes apps/mobile/ios, which it refuses to read");
  assert.doesNotMatch(steps[gate].body, /^\s*(if|continue-on-error):/m, "the gate must be able to fail the job");
});

test("the npm script runs this gate", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["check:mobile-native-declarations"], "node scripts/check-mobile-native-declarations.mjs");
});
