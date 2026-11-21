import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RequestReadsInterceptor } from './request-reads.interceptor';
import {
  requestReadsActive,
  runWithRequestReads,
} from '../../infrastructure/supabase/request-reads';

/** The line between a write's guards (shared reads) and its handler (#3728). */
describe('RequestReadsInterceptor', () => {
  const interceptor = new RequestReadsInterceptor();
  const context = {} as ExecutionContext;

  const activeInHandler = (method: string) =>
    runWithRequestReads(method, () => {
      let seen: boolean | undefined;
      const handler: CallHandler = {
        handle: () => {
          seen = requestReadsActive();
          return of('ok');
        },
      };
      return lastValueFrom(interceptor.intercept(context, handler)).then(
        () => seen,
      );
    });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'seals the store before a %s handler runs',
    async (method) => {
      await expect(activeInHandler(method)).resolves.toBe(false);
    },
  );

  it.each(['GET', 'HEAD'])(
    'leaves a %s handler sharing its guards’ reads',
    async (method) => {
      await expect(activeInHandler(method)).resolves.toBe(true);
    },
  );
});
