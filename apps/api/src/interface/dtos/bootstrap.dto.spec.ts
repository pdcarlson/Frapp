import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BOOTSTRAP_SECTION_NAMES } from '../../application/services/bootstrap.service';
import { BootstrapQueryDto } from './bootstrap.dto';

async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(BootstrapQueryDto, query);
  return { dto, errors: await validate(dto) };
}

describe('BootstrapQueryDto', () => {
  it('reads every section when include is omitted', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toEqual([]);
    expect(dto.include).toBeUndefined();
  });

  it('splits a comma-separated include, trimming and de-duplicating', async () => {
    const { dto, errors } = await parse({
      include: 'user, channels,user,,channel_unread',
    });
    expect(errors).toEqual([]);
    expect(dto.include).toEqual(['user', 'channels', 'channel_unread']);
  });

  it('accepts the key repeated', async () => {
    const { dto, errors } = await parse({ include: ['user', 'settings'] });
    expect(errors).toEqual([]);
    expect(dto.include).toEqual(['user', 'settings']);
  });

  it('accepts every section name', async () => {
    const { errors } = await parse({
      include: BOOTSTRAP_SECTION_NAMES.join(','),
    });
    expect(errors).toEqual([]);
  });

  it('refuses a name that is not a section', async () => {
    const { errors } = await parse({ include: 'user,messages' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('include');
  });
});
