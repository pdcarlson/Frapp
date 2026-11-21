// Prints the staging variant's runtime version for the checked-out tree (#4917).
//
// The staging build pipeline runs this after `npm ci` and exports the line as
// `FRAPP_STAGING_RUNTIME` in the shell that runs `eas build --local`, so the
// binary carries the same runtime the OTA guard computes for an update of the
// same tree (`stagingRuntimeVersion` in scripts/eas-update.mjs, which says why,
// and why a build on Expo's workers can't take it this way).
import { stagingRuntimeVersion } from "./eas-update.mjs";
import { isInvokedDirectly } from "./ci/lib/invoked-directly.mjs";

if (isInvokedDirectly(import.meta.url)) {
  const result = stagingRuntimeVersion();
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(result.runtime);
}
