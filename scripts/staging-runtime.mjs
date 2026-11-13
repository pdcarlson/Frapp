// Prints the staging variant's runtime version for the checked-out tree (#4917).
//
// The staging build pipeline runs this after `npm ci` and exports the line as
// `FRAPP_STAGING_RUNTIME` before it builds Frapp Staging, so the binary carries
// the same runtime the OTA guard computes for an update of the same tree
// (`stagingRuntimeVersion` in scripts/eas-update.mjs, which says why).
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
