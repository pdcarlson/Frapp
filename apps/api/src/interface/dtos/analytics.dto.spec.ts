import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';
import { TrackEventDto } from './analytics.dto';

/**
 * `app` names the client that sent an event; the API stamps it on the event
 * (#3381). Only `web` and `mobile` may claim it: `api` marks the API's own
 * events. The field is optional so an older client that sends none still
 * records its event. Run through the production pipe options.
 */
describe('TrackEventDto — app (#3381)', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: TrackEventDto,
    data: '',
  };
  const transform = (payload: unknown) => pipe.transform(payload, metadata);

  it.each(['web', 'mobile'])('accepts app %s', async (app) => {
    await expect(transform({ name: 'search-completed', app })).resolves.toEqual(
      expect.objectContaining({ app }),
    );
  });

  it('accepts an event that names no app', async () => {
    const dto = (await transform({
      name: 'search-completed',
    })) as TrackEventDto;
    expect(dto.app).toBeUndefined();
  });

  it.each(['api', 'landing', 'WEB', ''])('rejects app %j', async (app) => {
    await expect(
      transform({ name: 'search-completed', app }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
