import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPECTED_HEALTH_CHECK_PATH,
  readHealthCheckPath,
} from "../lib/render-health-check-path.mjs";
import {
  EXPECTED_HEALTH_CHECK_PATH as fromGuardrails,
  readHealthCheckPath as fromGuardrailsFn,
} from "../production-guardrails.mjs";

describe("render-health-check-path shared lib", () => {
  it("exports the nested /health contract production-guardrails re-exports", () => {
    assert.equal(EXPECTED_HEALTH_CHECK_PATH, "/health");
    assert.equal(fromGuardrails, EXPECTED_HEALTH_CHECK_PATH);
    assert.equal(fromGuardrailsFn, readHealthCheckPath);
  });

  it("reads only service.serviceDetails.healthCheckPath", () => {
    assert.equal(
      readHealthCheckPath({
        serviceDetails: { healthCheckPath: "/health" },
      }),
      "/health",
    );
    assert.equal(
      readHealthCheckPath({
        healthCheckPath: "/health",
        service: { serviceDetails: { healthCheckPath: "/health/ready" } },
      }),
      undefined,
    );
  });
});
