import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BillingService } from '../../application/services/billing.service';
import { BILLING_PROVIDER } from '#domain/adapters/billing.interface';
import type { WebhookRequest } from '../types/request-context.types';

/**
 * `POST /v1/webhooks/stripe` is an unauthenticated, deliberately un-throttled
 * route: the controller carries `@SkipThrottle({ read: true, write: true })`
 * because Stripe delivers bursts from a small shared IP pool and the global
 * per-IP throttler 429s real billing events. Its own comment names signature
 * verification as the abuse control that replaces the rate limit.
 *
 * That makes the reject branches the whole security boundary, so these tests
 * assert two things per failure, not one: the status code, **and** that
 * `BillingService.handleWebhookEvent` was never reached. A test that checked
 * only the status would still pass if the controller applied the event and
 * threw afterwards, which is the failure that actually matters here.
 *
 * Division of labour with `test/billing-webhook.e2e-spec.ts`, which exercises
 * the same route over real HTTP: that suite proves the wiring — status codes
 * and the response body — for the missing-header, invalid-signature and
 * valid-signature cases. This spec covers the branches HTTP cannot reach
 * cheaply (a missing raw body, a non-Error thrown by the provider) and pins
 * the arguments verification is called with. Before this change, the
 * invalid-signature branch was untested at either layer.
 */
describe('WebhookController', () => {
  let controller: WebhookController;
  let billingService: { handleWebhookEvent: jest.Mock };
  let billingProvider: { constructWebhookEvent: jest.Mock };

  const VALID_EVENT = {
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: { object: { metadata: { chapter_id: 'ch-1' } } },
  };

  /** A request carrying a raw body, as `bootstrap`'s rawBody parsing supplies. */
  function requestWithBody(body = '{"id":"evt_test_1"}'): WebhookRequest {
    return { rawBody: Buffer.from(body) } as WebhookRequest;
  }

  beforeEach(async () => {
    billingService = {
      handleWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };
    billingProvider = {
      constructWebhookEvent: jest.fn().mockReturnValue(VALID_EVENT),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: BillingService, useValue: billingService },
        { provide: BILLING_PROVIDER, useValue: billingProvider },
      ],
    }).compile();

    controller = module.get<WebhookController>(WebhookController);
  });

  // The logger spy below is installed on the controller's own `logger` field.
  // A fresh controller per test makes leaking it moot *today*, but that safety
  // rests on `logger` staying per-instance — move it to a shared or injected
  // logger and an unrestored spy would silence `warn` for the rest of the file
  // with nothing failing. Restore explicitly rather than depend on that.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('signature verification', () => {
    it('rejects an invalid signature with 401 and never reaches billing', async () => {
      // The gap this spec exists to close: no test at any layer asserted the
      // verification-failure branch, which is what stops a forged payload from
      // moving subscription state on an unauthenticated, un-throttled route.
      billingProvider.constructWebhookEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });

      await expect(
        controller.handleStripeWebhook(requestWithBody(), 'sig_forged'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(billingProvider.constructWebhookEvent).toHaveBeenCalledTimes(1);
      expect(billingService.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('does not leak the provider error message to the caller', async () => {
      // The provider's message can name the expected signature scheme and the
      // timestamp tolerance. It is logged, not returned.
      const logged = jest
        .spyOn(controller['logger'], 'warn')
        .mockImplementation(() => undefined);
      billingProvider.constructWebhookEvent.mockImplementation(() => {
        throw new Error('Expected signature v1=deadbeef, tolerance 300s');
      });

      const thrown = await controller
        .handleStripeWebhook(requestWithBody(), 'sig_forged')
        .then(
          () => null,
          (err: unknown) => err,
        );

      // `.rejects.toThrow('...')` would NOT do here: it is a substring match,
      // so it passes for a message that *appends* the provider's text to the
      // safe prefix — which is the shape this regression actually takes. Assert
      // the whole message, and the absence of the leaked detail explicitly.
      expect(thrown).toBeInstanceOf(UnauthorizedException);
      expect((thrown as UnauthorizedException).message).toBe(
        'Invalid Stripe webhook signature',
      );
      expect((thrown as UnauthorizedException).message).not.toContain(
        'deadbeef',
      );

      // The other half of the claim: suppressed for the caller, kept for us.
      // A forged-signature attempt on an unauthenticated, un-throttled route
      // must leave a trace somewhere.
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('deadbeef'));
    });

    it('rejects a non-Error thrown by the provider just the same', async () => {
      // The catch formats `error instanceof Error ? error.message : error`, so
      // a thrown string must still land as a 401 rather than escaping as a 500.
      billingProvider.constructWebhookEvent.mockImplementation(() => {
        // Throwing a non-Error is the input under test — it is what exercises
        // the `: error` half of the catch — so the rule is suppressed rather
        // than the case dropped.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'verification exploded';
      });

      await expect(
        controller.handleStripeWebhook(requestWithBody(), 'sig_forged'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(billingService.handleWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe('request preconditions', () => {
    it('rejects a missing stripe-signature header with 400', async () => {
      await expect(
        controller.handleStripeWebhook(
          requestWithBody(),
          undefined as unknown as string,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      // 400 before 401: an absent header is a malformed request, not a failed
      // verification, so the provider is never consulted.
      expect(billingProvider.constructWebhookEvent).not.toHaveBeenCalled();
      expect(billingService.handleWebhookEvent).not.toHaveBeenCalled();
    });

    it('rejects an empty stripe-signature header with 400', async () => {
      // The guard is `!signature`, so '' takes the same branch as a missing
      // header rather than reaching the provider with a blank signature.
      await expect(
        controller.handleStripeWebhook(requestWithBody(), ''),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(billingProvider.constructWebhookEvent).not.toHaveBeenCalled();
    });

    it('rejects a request with no raw body with 400', async () => {
      // Signature verification is computed over the raw bytes; a parsed body
      // cannot be re-serialized faithfully, so a missing rawBody must fail
      // rather than fall through to verification against something else.
      await expect(
        controller.handleStripeWebhook({} as WebhookRequest, 'sig_valid'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(billingProvider.constructWebhookEvent).not.toHaveBeenCalled();
      expect(billingService.handleWebhookEvent).not.toHaveBeenCalled();
    });
  });

  describe('accepted webhook', () => {
    it('verifies against the raw body and the supplied signature', async () => {
      const rawBody = Buffer.from('{"id":"evt_test_1"}');

      await controller.handleStripeWebhook(
        { rawBody } as WebhookRequest,
        'sig_valid',
      );

      // Pins the arguments, not just that it was called: verifying a
      // re-serialized body, or against a signature from anywhere but the
      // header, would defeat the check while still "passing".
      expect(billingProvider.constructWebhookEvent).toHaveBeenCalledWith(
        rawBody,
        'sig_valid',
      );
    });

    it('forwards the constructed event — not the raw payload — to billing', async () => {
      const result = await controller.handleStripeWebhook(
        requestWithBody(),
        'sig_valid',
      );

      expect(billingService.handleWebhookEvent).toHaveBeenCalledWith(
        VALID_EVENT,
      );
      expect(result).toEqual({ received: true });
    });

    it('propagates a billing-service failure instead of acknowledging', async () => {
      // A 2xx tells Stripe the event is handled and it stops retrying, so a
      // failed apply must not return `{ received: true }`.
      billingService.handleWebhookEvent.mockRejectedValue(
        new Error('billing exploded'),
      );

      await expect(
        controller.handleStripeWebhook(requestWithBody(), 'sig_valid'),
      ).rejects.toThrow('billing exploded');
    });
  });
});
