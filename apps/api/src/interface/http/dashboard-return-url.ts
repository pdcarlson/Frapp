import { BadRequestException } from '@nestjs/common';
import { CORS_ALLOWED_ORIGINS } from './cors.options';
import {
  deploymentEnvironment,
  type DeploymentEnvironment,
} from './deployment-environment';

/**
 * A return address the API hands to a third party (Stripe Checkout's success
 * and cancel pages, the billing portal's way back) must be the dashboard's
 * own: the origins this deployment's CORS admits, the same list that says
 * which pages call the API at all. Without it a Frapp-minted Stripe link
 * could send a treasurer on to any site after paying.
 */
export function assertDashboardReturnUrl(
  value: string,
  field: string,
  environment: DeploymentEnvironment = deploymentEnvironment(),
): string {
  let origin: string | null = null;
  try {
    origin = new URL(value).origin;
  } catch {
    origin = null;
  }
  if (!origin || !CORS_ALLOWED_ORIGINS[environment].includes(origin)) {
    throw new BadRequestException(
      `${field} must be a Frapp dashboard address.`,
    );
  }
  return value;
}
